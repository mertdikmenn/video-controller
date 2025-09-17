import { API_GENERATE_TOKEN_URL, WEBSOCKET_URL, MSG_TYPE } from './config.js';
import { RelayConnection } from './relay-connection.js';
import { togglePlaybackOnActiveTab } from './player-control.js';

// --- INITIALIZATION ---
const relay = new RelayConnection(WEBSOCKET_URL);
let currentPairingToken = null;

// --- LOGIC ---
function handleRelayMessage(msg) {
    console.log("[bg] Received message from relay:", msg);
    switch (msg.type) {
        case MSG_TYPE.TOGGLE:
            togglePlaybackOnActiveTab().then(success => {
                relay.send({ type: MSG_TYPE.ACK, ok: success, action: "toggled"});
            });
            break;
        case MSG_TYPE.PAIR_SUCCESS:
            console.log("[bg] Pairing successful!");
            currentPairingToken = null; // Clear the token once pairing is done

            // The server has confirmed the remote is connected. Now we are truly "connected".
            relay._updateStatus("connected"); // We can call the private method here as we are the orchestrator
            break;
        default:
            console.log(`[bg] Message type is not recognized: ${msg.type}`);
            break;
        // Add other commands like 'play', 'pause', 'seek' here in the future
    }
}

// What to do when the connection status changes
function handleStatusChange(newStatus) {
    // Notify any open popups about the status change
    chrome.runtime.sendMessage({ type: MSG_TYPE.RELAY_STATUS_UPDATE, status: newStatus }).catch(() => {});
}

// Wire up the callbacks
relay.onMessage(handleRelayMessage);
relay.onStatusChange(handleStatusChange);


// --- CHROME EVENT LISTENERS ---
// Listen for messages from the popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.command) {
        case MSG_TYPE.START_PAIRING:
            // This is an async operation, so we handle the promise
            (async () => {
                try {
                    const response = await fetch(API_GENERATE_TOKEN_URL);
                    if (!response.ok) throw new Error(`API error: ${response.statusText}`);
                    
                    const data = await response.json();
                    const token = data.token;

                    if (!token) throw new Error("No token received from API");

                    currentPairingToken = token;

                    // Connect the relay with the new token
                    relay.connect(token);
                    
                    // Send the token back to the popup so it can render the QR code
                    sendResponse({ success: true, token: token });
                } catch (error) {
                    console.error("Failed to start pairing:", error);
                    relay.disconnect(); // Ensure we are in a clean state
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Required for async sendResponse

        case MSG_TYPE.DISCONNECT_RELAY:
            currentPairingToken = null; // Clear the token once pairing is done
            relay.disconnect();
            sendResponse({ status: relay.getStatus() });
            break;

        case MSG_TYPE.GET_RELAY_STATUS:
            // Sends the token along with the status if pairing
            const status = relay.getStatus();
            const responsePayload = { status };
            if (status === "pairing" & currentPairingToken) {
                responsePayload.token = currentPairingToken;
            }
            sendResponse(responsePayload);
            break;
    }
    return true; // Keep message channel open for async responses
});