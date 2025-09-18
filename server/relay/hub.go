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

const sessionLifetime = 24 * time.Hour     // 24-hour session duration
const sessionCleanupInterval = time.Minute // How often to check for expired sessions

// Session holds the two connection roles.
type Session struct {
	mu        sync.Mutex
	Player    *websocket.Conn
	Remote    *websocket.Conn
	ExpiresAt time.Time
}

// Hub manages the collection of active rooms.
type Hub struct {
	mu           sync.Mutex
	sessions     map[string]*Session
	tokenManager *pairing.TokenManager
}

// NewHub creates a new Hub.
func NewHub(tm *pairing.TokenManager) *Hub {
	h := &Hub{
		sessions:     make(map[string]*Session),
		tokenManager: tm,
	}
	go h.cleanupExpiredSessions()
	return h
}

func (h *Hub) getOrCreateSession(id string) *Session {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.sessions[id] == nil {
		h.sessions[id] = &Session{}
		log.Printf("Created new temporary session holder: %s", id)
	}

	return h.sessions[id]
}

// Goroutine to periodically clean up expired sessions
func (h *Hub) cleanupExpiredSessions() {
	ticker := time.NewTicker(sessionCleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		h.mu.Lock()
		for id, session := range h.sessions {
			// Check if the session is expired AND no one is connected
			if time.Now().After(session.ExpiresAt) {
				session.mu.Lock()
				playerConnected := session.Player != nil
				remoteConnected := session.Remote != nil

				if !playerConnected && !remoteConnected {
					log.Printf("Cleaning up expired and empty session: %s", id)
					delete(h.sessions, id)
				}
			}
		}
		h.mu.Unlock()
	}
}

func (h *Hub) getSession(id string) (*Session, bool) {
	h.mu.Lock()
	defer h.mu.Unlock()
	session, exists := h.sessions[id]
	return session, exists
}

// forwardMessage handles forwarding a message from a sender to its paired peer.
func (h *Hub) forwardMessage(session *Session, sender *websocket.Conn, msg []byte) {
	session.mu.Lock()
	defer session.mu.Unlock()

	// Determine the recipient based on the sender
	var recipient *websocket.Conn
	if sender == session.Player && session.Remote != nil {
		recipient = session.Remote
	} else if sender == session.Remote && session.Player != nil {
		recipient = session.Player
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
		sessionID := query.Get("room")
		role := query.Get("role")

		if sessionID == "" || (role != "player" && role != "remote") {
			http.Error(w, "Missing or invalid 'session' or 'role' query parameter", http.StatusBadRequest)
			return
		}

		var session *Session

		existingSession, exists := h.getSession(sessionID)
		isTempToken := h.tokenManager.IsTokenValid(sessionID)

		if exists {
			// It's an existing session. Check for expiry.
			if !existingSession.ExpiresAt.IsZero() && time.Now().After(existingSession.ExpiresAt) {
				log.Printf("Rejecting connection to expired session: %s", sessionID)
				http.Error(w, "Session expired", http.StatusGone) // 410 Gone
				return
			}
			session = existingSession
		} else if isTempToken {
			// It's a new pairing. Create a temporary session holder.
			h.mu.Lock()
			// Double check it wasn't created in the meantime
			if h.sessions[sessionID] == nil {
				h.sessions[sessionID] = &Session{}
				log.Printf("Created new temporary session holder: %s", sessionID)
			}
			session = h.sessions[sessionID]
			h.mu.Unlock()
		} else {
			// It's not an existing session and not a valid temp token. Reject.
			log.Printf("Rejecting connection to non-existent session: %s", sessionID)
			http.Error(w, "Session not found", http.StatusNotFound) // 404 Not Found
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

		// Role-based connection logic
		session.mu.Lock()
		if role == "player" {
			if session.Player != nil {
				// A player is already connected, reject this new connection.
				session.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Player already connected to this room.")
				return
			}
			session.Player = c
			log.Printf("Player connected to room: %s", sessionID)
		} else { // role == "remote"
			if session.Remote != nil {
				// A remote is already connected, reject.
				session.mu.Unlock()
				c.Close(websocket.StatusPolicyViolation, "Remote already connected to this room.")
				return
			}
			session.Remote = c
			log.Printf("Remote connected to room: %s", sessionID)
		}

		// Check for successful pairing. If both are now connected, notify them.
		if session.Player != nil && session.Remote != nil {
			if h.tokenManager.ValidateAndClaimToken(sessionID) {
				// Create a permanent session
				log.Printf("Initial pairing for temporary session: %s.", sessionID)
				permanentSessionID := uuid.NewString()
				log.Printf("Generated permanent session ID: %s", permanentSessionID)

				// Create the new permanent session "slot"
				h.mu.Lock()
				h.sessions[permanentSessionID] = &Session{
					ExpiresAt: time.Now().Add(sessionLifetime),
				}
				h.mu.Unlock()

				// Delete the temporary session holder
				h.mu.Lock()
				delete(h.sessions, sessionID)
				h.mu.Unlock()

				// Notify clients of the new permanent session ID
				payload := map[string]string{
					"type":         "pair_success",
					"sessionToken": permanentSessionID,
				}
				pairSuccessMsg, _ := json.Marshal(payload)

				// Send to the connections which are still technically in the temp session object
				go session.Player.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
				go session.Remote.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
			} else {
				// This is a RECONNECTION to a permanent session room
				log.Printf("Reconnection successful for session: %s.", sessionID)
				pairSuccessMsg := []byte(`{"type":"pair_success"}`)
				go session.Player.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
				go session.Remote.Write(context.Background(), websocket.MessageText, pairSuccessMsg)
			}
		}
		session.mu.Unlock()

		// The temporary session holder will be empty and eventually cleaned up if something goes wrong.
		defer func() {
			// This logic will apply to whatever session the client is currently in
			// which will be the permanent one after reconnect.
			session.mu.Lock()
			if role == "player" {
				session.Player = nil
				log.Printf("Player disconnected from session: %s", sessionID)
			} else {
				session.Remote = nil
				log.Printf("Remote disconnected from session: %s", sessionID)
			}
			session.mu.Unlock()
		}()

		// Read loop
		for {
			_, data, err := c.Read(r.Context())
			if err != nil {
				break
			}
			h.forwardMessage(session, c, data)
		}
	}
}
