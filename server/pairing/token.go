package pairing

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
)

const tokenExpiryDuration = 2 * time.Minute

// PairingToken holds information about a pending token
type PairingToken struct {
	ID        string
	ExpiresAt time.Time
}

// TokenManager manages the lifecycle of pairing tokens
type TokenManager struct {
	mu     sync.RWMutex
	tokens map[string]PairingToken
}

// NewTokenManager creates a new TokenManager and starts the cleanup goroutine
func NewTokenManager() *TokenManager {
	tm := &TokenManager{
		tokens: make(map[string]PairingToken),
	}
	go tm.cleanupExpiredTokens()
	return tm
}

// GenerateToken creates, stores, and returns a new unique token
func (tm *TokenManager) GenerateToken() string {
	newUUID, _ := uuid.NewRandom()
	tokenID := newUUID.String()

	token := PairingToken{
		ID:        tokenID,
		ExpiresAt: time.Now().Add(tokenExpiryDuration),
	}

	tm.mu.Lock()
	tm.tokens[tokenID] = token
	tm.mu.Unlock()

	log.Printf("Generated new pairing token: %s", tokenID)
	return tokenID
}

// ValidateAndClaimToken checks if a token is valid and removes it to prevent reuse
func (tm *TokenManager) ValidateAndClaimToken(tokenID string) bool {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	token, exists := tm.tokens[tokenID]
	if !exists || time.Now().After(token.ExpiresAt) {
		return false // Token doesn't exist or expired
	}

	// Token is valid, claim it by deleting it
	delete(tm.tokens, tokenID)
	log.Printf("Token %s successfully claimed.", tokenID)
	return true
}

// cleanupExpiredTokens periodically removes expired tokens from the map.
func (tm *TokenManager) cleanupExpiredTokens() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		tm.mu.Lock()
		for id, token := range tm.tokens {
			if time.Now().After(token.ExpiresAt) {
				log.Printf("Cleaning up expired token: %s", id)
				delete(tm.tokens, id)
			}
		}
		tm.mu.Unlock()
	}
}

// GenerateTokenHandler returns an http.HandlerFunc for the token generation API
func (tm *TokenManager) GenerateTokenHandler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// --- CORS Headers ---
		// Allow requests from any origin (e.g., your Chrome extension)
		// In a production environment with known origins, you might restrict this.
		// For an extension, using "*" for Origin is often necessary due to dynamic extension IDs.
		w.Header().Set("Access-Control-Allow-Origin", "https://app.videocontrol.dev")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		tokenID := tm.GenerateToken()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": tokenID})
	}
}
