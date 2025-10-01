package relay

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
	"videocontrol/pairing"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

const roomExpiryDuration = 24 * time.Hour
const cleanupInterval = 5 * time.Minute

// Room holds the two connection roles.
type Room struct {
	mu                 sync.Mutex
	Player             *websocket.Conn
	Remote             *websocket.Conn
	IsTemporary        bool
	LastDisconnectedAt *time.Time
}

// Hub manages the collection of active rooms.
type Hub struct {
	mu           sync.Mutex
	rooms        map[string]*Room
	tokenManager *pairing.TokenManager
}

// NewHub creates a new Hub.
func NewHub(tm *pairing.TokenManager) *Hub {
	h := &Hub{
		rooms:        make(map[string]*Room),
		tokenManager: tm,
	}
	go h.cleanupExpiredRooms()
	return h
}

func (h *Hub) getRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[id]
}

func (h *Hub) createRoom(id string, isTemporary bool) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Double check it doesn't exist to prevent race conditions
	if h.rooms[id] == nil {
		h.rooms[id] = &Room{IsTemporary: isTemporary}
		log.Printf("Created new room: %s (Temporary: %v)", id, isTemporary)
	}
	return h.rooms[id]
}

// Background process to clean up expired rooms.
func (h *Hub) cleanupExpiredRooms() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		roomsToDelete := []string{}

		// First, identify which rooms to delete without holding the hub lock for too long.
		h.mu.Lock()
		for id, room := range h.rooms {
			room.mu.Lock()
			// Check if the room is empty and has been for longer than the expiry duration.
			if room.LastDisconnectedAt != nil && time.Since(*room.LastDisconnectedAt) > roomExpiryDuration {
				roomsToDelete = append(roomsToDelete, id)
			}
			room.mu.Unlock()
		}
		h.mu.Unlock()

		// Now, perform the deletion of the identified rooms.
		if len(roomsToDelete) > 0 {
			h.mu.Lock()
			for _, id := range roomsToDelete {
				// Double-check the room wasn't re-activated while we weren't looking.
				if room, ok := h.rooms[id]; ok {
					room.mu.Lock()
					if room.LastDisconnectedAt != nil && time.Since(*room.LastDisconnectedAt) > roomExpiryDuration {
						delete(h.rooms, id)
						log.Printf("Cleaned up expired room: %s", id)
					}
					room.mu.Unlock()
				}
			}
			h.mu.Unlock()
		}
	}
}

// forwardMessage handles forwarding a message from a sender to its paired peer.
func (h *Hub) forwardMessage(room *Room, sender *websocket.Conn, msg []byte) {
	room.mu.Lock()
	defer room.mu.Unlock()

	// Determine the recipient based on the sender
	var recipient *websocket.Conn
	if sender == room.Player && room.Remote != nil {
		recipient = room.Remote
	} else if sender == room.Remote && room.Player != nil {
		recipient = room.Player
	}

	if recipient != nil {
		// Write in a goroutine to avoid blocking the read loop
		go func() {
			err := recipient.Write(context.Background(), websocket.MessageText, msg)
			if err != nil {
				log.Printf("Error forwarding message: %v", err)
			}
		}()
	}
}

func (h *Hub) ServeWsHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query()
		roomID := query.Get("room")
		role := query.Get("role")

		if roomID == "" || (role != "player" && role != "remote") {
			http.Error(w, "Missing or invalid 'room' or 'role' query parameter", http.StatusBadRequest)
			return
		}

		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{OriginPatterns: []string{"*"}})
		if err != nil {
			log.Printf("Error accepting websocket: %v", err)
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "Connection closed.")

		var room *Room

		if role == "player" {
			// Is this a connection with a fresh, temporary token?
			if h.tokenManager.ValidateAndClaimToken(roomID) {
				// Create a temporary room
				room = h.createRoom(roomID, true)
			} else {
				// This must be a reconnection with a permanent session token.
				room = h.getRoom(roomID)
				if room == nil {
					// This can happen if the remote disconnects first, deleting the room.
					// So we create it.
					room = h.createRoom(roomID, false)
				}
			}

			room.mu.Lock()
			if room.Player != nil {
				room.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Player already connected.")
				return
			}
			room.Player = c
			room.LastDisconnectedAt = nil // Mark room as active
			log.Printf("Player connected to room: %s", roomID)
			room.mu.Unlock()
		} else { // role == "remote"
			room = h.getRoom(roomID)
			if room == nil {
				log.Printf("Remote connection rejected for room %s: room not found", roomID)
				c.Close(4001, "Invalid or expired session.")
				return
			}
			room.mu.Lock()
			if room.Remote != nil {
				room.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Remote already connected.")
				return
			}
			room.Remote = c
			room.LastDisconnectedAt = nil // Mark room as active
			log.Printf("Remote connected to room: %s", roomID)
			room.mu.Unlock()
		}

		// Check for pairing completion
		room.mu.Lock()
		if room.Player != nil && room.Remote != nil {
			if room.IsTemporary {
				log.Printf("Initial pairing complete for temporary room: %s.", roomID)

				// Generate the session token
				sessionToken := uuid.NewString()
				log.Printf("Generated permanent session token: %s", sessionToken)
				payload := map[string]string{"type": "pair_success", "sessionToken": sessionToken}
				pairSuccessMsg, _ := json.Marshal(payload)

				// Send the new token to both clients
				go room.Player.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
				go room.Remote.Write(context.Background(), websocket.MessageText, pairSuccessMsg)

				// IMPORTANT: Mark this room as no longer temporary so we don't generate
				// another token if one of the clients disconnects and reconnects quickly.
				room.IsTemporary = false
			} else {
				log.Printf("Reconnection successful for room: %s.", roomID)
				pairSuccessMsg := []byte(`{"type":"pair_success"}`)
				go room.Player.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
				go room.Remote.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
			}
		}
		room.mu.Unlock()

		// Defer and read loop
		defer func() {
			room.mu.Lock()
			isTemporaryBeforeDisconnect := room.IsTemporary
			if role == "player" {
				room.Player = nil
				log.Printf("Player disconnected from room: %s", roomID)
			} else {
				room.Remote = nil
				log.Printf("Remote disconnected from room: %s", roomID)
			}

			// If the room is now empty, start the expiration timer (if it's a permanent room)
			if room.Player == nil && room.Remote == nil && !isTemporaryBeforeDisconnect {
				log.Printf("Room is empty, starting 24h expiration timer: %s", roomID)
				now := time.Now()
				room.LastDisconnectedAt = &now
			}
			room.mu.Unlock()

			// If the room was temporary and is now empty, clean it up immediately.
			// This handles cases where a user generates a QR code but never scans it.
			if isTemporaryBeforeDisconnect && room.Player == nil && room.Remote == nil {
				h.mu.Lock()
				delete(h.rooms, roomID)
				log.Printf("Abandoned temporary room %s deleted.", roomID)
				h.mu.Unlock()
			}
		}()

		for {
			_, data, err := c.Read(r.Context())
			if err != nil {
				break
			}
			h.forwardMessage(room, c, data)
		}
	}
}
