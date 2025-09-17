package main

import (
	"log"
	"net/http"
	"videocontrol/pairing"
	"videocontrol/relay"
)

func main() {
	// 1. Initialize our modules
	tokenManager := pairing.NewTokenManager()
	hub := relay.NewHub(tokenManager)

	// 2. Register the HTTP handlers from our modules
	http.HandleFunc("/api/generate-token", tokenManager.GenerateTokenHandler())
	http.HandleFunc("/ws", hub.ServeWsHandler())

	// 3. Start the server
	port := ":8080"
	log.Printf("Server starting on port %s", port)
	log.Println("API endpoint: http://localhost:8080/api/generate-token")
	log.Println("WebSocket endpoint: ws://localhost:8080/ws?room=ROOM_NAME")

	err := http.ListenAndServe(port, nil)
	if err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
