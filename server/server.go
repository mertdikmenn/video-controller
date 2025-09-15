package main

import (
	"context"
	"log"
	"net/http"
	"sync"

	"github.com/coder/websocket"
)

type hub struct {
	mu    sync.Mutex
	rooms map[string]map[*websocket.Conn]bool
}

func newHub() *hub { return &hub{rooms: make(map[string]map[*websocket.Conn]bool)} }

func (h *hub) join(room string, c *websocket.Conn) func() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[room] == nil {
		h.rooms[room] = make(map[*websocket.Conn]bool)
	}
	h.rooms[room][c] = true
	return func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		delete(h.rooms[room], c)
		if len(h.rooms[room]) == 0 {
			delete(h.rooms, room)
		}
	}
}

func (h *hub) broadcast(room string, from *websocket.Conn, msg []byte) {
	h.mu.Lock()
	conns := h.rooms[room]
	h.mu.Unlock()
	for c := range conns {
		if c == from {
			continue
		}
		_ = c.Write(context.Background(), websocket.MessageText, msg)
	}
}

func main() {
	h := newHub()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		room := r.URL.Query().Get("room")
		if room == "" {
			http.Error(w, "room required", 400)
			return
		}
		c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			OriginPatterns: []string{"*"}, // tighten later
		})
		if err != nil {
			return
		}
		defer c.Close(websocket.StatusNormalClosure, "bye")

		cleanup := h.join(room, c)
		defer cleanup()

		for {
			typ, data, err := c.Read(r.Context())
			if err != nil {
				return
			}
			if typ == websocket.MessageText {
				h.broadcast(room, c, data)
			}
		}
	})

	log.Println("relay on :8080 (ws://HOST:8080/ws?room=XYZ)")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
