package relay

import (
	"context"
	"log"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

// Room holds the two connection roles.
type Room struct {
	mu     sync.Mutex
	Player *websocket.Conn
	Remote *websocket.Conn
}

// Hub manages the collection of active rooms.
type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
}

// NewHub creates a new Hub.
func NewHub() *Hub {
	return &Hub{
		rooms: make(map[string]*Room),
	}
}

// getOrCreateRoom finds a room by ID or creates it if it doesn't exist.
func (h *Hub) getOrCreateRoom(id string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()

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

		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: []string{"*"}, // TODO: Tighten for production
		})
		if err != nil {
			log.Printf("Error accepting websocket: %v", err)
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "Connection closed.")

		room := h.getOrCreateRoom(roomID)

		// --- Role-based connection logic ---
		room.mu.Lock()
		if role == "player" {
			if room.Player != nil {
				// A player is already connected, reject this new connection.
				room.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Player already connected to this room.")
				return
			}
			room.Player = c
			log.Printf("Player connected to room: %s", roomID)
		} else { // role == "remote"
			if room.Remote != nil {
				// A remote is already connected, reject.
				room.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Remote already connected to this room.")
				return
			}
			room.Remote = c
			log.Printf("Remote connected to room: %s", roomID)
		}

		// Check for successful pairing. If both are now connected, notify them.
		if room.Player != nil && room.Remote != nil {
			log.Printf("Pairing complete for room: %s. Notifying clients.", roomID)
			pairSuccessMsg := []byte(`{"type":"pair_success"}`)
			// Write in goroutines to avoid blocking
			go room.Player.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
			go room.Remote.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
		}
		room.mu.Unlock()

		// --- Cleanup logic ---
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

		// --- Read loop ---
		for {
			_, data, err := c.Read(r.Context())
			if err != nil {
				break
			}
			h.forwardMessage(room, c, data)
		}
	}
}
