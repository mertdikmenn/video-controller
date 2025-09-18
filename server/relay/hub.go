package relay

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"videocontrol/pairing"

	"github.com/coder/websocket"
	"github.com/google/uuid"
)

// Room holds the two connection roles.
type Room struct {
	mu     sync.Mutex
	Player *websocket.Conn
	Remote *websocket.Conn
}

// Hub manages the collection of active rooms.
type Hub struct {
	mu           sync.Mutex
	rooms        map[string]*Room
	tokenManager *pairing.TokenManager
}

// NewHub creates a new Hub.
func NewHub(tm *pairing.TokenManager) *Hub {
	return &Hub{
		rooms:        make(map[string]*Room),
		tokenManager: tm,
	}
}

func (h *Hub) getRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[id]
}

func (h *Hub) createRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Double check it doesn't exist to prevent race conditions
	if h.rooms[id] == nil {
		h.rooms[id] = &Room{}
		log.Printf("Created new room: %s", id)
	}
	return h.rooms[id]
}

// Room cleanup logic
func (h *Hub) cleanupRoomIfEmpty(roomID string, room *Room) {
	room.mu.Lock()
	isPlayerConnected := room.Player != nil
	isRemoteConnected := room.Remote != nil
	room.mu.Unlock()

	if !isPlayerConnected && !isRemoteConnected {
		h.mu.Lock()
		defer h.mu.Unlock()

		// Double-check in case a new client connected in the meantime
		if room.Player == nil && room.Remote == nil {
			delete(h.rooms, roomID)
			log.Printf("Room empty, deleting room: %s", roomID)
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
		isInitialPairing := false

		if role == "player" {
			// Is this a connection with a fresh, temporary token?
			if h.tokenManager.ValidateAndClaimToken(roomID) {
				isInitialPairing = true
				room = h.createRoom(roomID)
			} else {
				// This must be a reconnection with a permanent session token.
				room = h.getRoom(roomID)
				if room == nil {
					// This can happen if the remote disconnects first, deleting the room.
					// So we create it.
					room = h.createRoom(roomID)
				}
			}

			room.mu.Lock()
			if room.Player != nil {
				room.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Player already connected.")
				return
			}
			room.Player = c
			log.Printf("Player connected to room: %s", roomID)
			room.mu.Unlock()
		} else { // role == "remote"
			room = h.getRoom(roomID)
			if room == nil {
				log.Printf("Remote connection rejected for room %s: room not found", roomID)
				c.Close(websocket.StatusPolicyViolation, "Pairing code not found or expired.")
				return
			}
			room.mu.Lock()
			if room.Remote != nil {
				room.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Remote already connected.")
				return
			}
			room.Remote = c
			log.Printf("Remote connected to room: %s", roomID)
			room.mu.Unlock()
		}

		// Check for pairing completion
		room.mu.Lock()
		if room.Player != nil && room.Remote != nil {
			if isInitialPairing {
				log.Printf("Initial pairing complete for temporary room: %s.", roomID)
				sessionToken := uuid.NewString()
				log.Printf("Generated permanent session token: %s", sessionToken)
				payload := map[string]string{"type": "pair_success", "sessionToken": sessionToken}
				pairSuccessMsg, _ := json.Marshal(payload)
				go room.Player.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
				go room.Remote.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
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
			if role == "player" {
				room.Player = nil
				log.Printf("Player disconnected from room: %s", roomID)
			} else {
				room.Remote = nil
				log.Printf("Remote disconnected from room: %s", roomID)
			}
			room.mu.Unlock()
			h.cleanupRoomIfEmpty(roomID, room)
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
