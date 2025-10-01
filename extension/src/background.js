import { API_GENERATE_TOKEN_URL, WEBSOCKET_URL, MSG_TYPE } from './config.js';
import { RelayConnection } from './relay-connection.js';
import { togglePlaybackOnActiveTab, toggleMuteOnActiveTab, seekOnActiveTab, setVolumeOnActiveTab } from './player-control.js';
import { logger } from './logger.js';

// --- CONSTANTS ---
const SESSION_TOKEN_KEY = 'sessionToken';

// --- INITIALIZATION ---
const relay = new RelayConnection(WEBSOCKET_URL);
let currentPairingToken = null;

function handleFatalRelayError() {
    logger.log("[bg] Fatal relay error detected. Clearing session token.");
    chrome.storage.local.remove(SESSION_TOKEN_KEY);
    // The relay connection class will handle its own state reset.
}

// --- LOGIC ---
function handleRelayMessage(msg) {
    logger.log("[bg] Received message from relay:", msg);
    switch (msg.type) {
        case MSG_TYPE.TOGGLE:
            togglePlaybackOnActiveTab().then(success => {
                relay.send({ type: MSG_TYPE.ACK, ok: success, action: "toggled"});
            });
            break;
        case MSG_TYPE.MUTE:
            toggleMuteOnActiveTab().then(success => {
                relay.send({ type: MSG_TYPE.ACK, ok: success, action: "muted"});
            });
            break;
        case MSG_TYPE.SEEK:
            if (typeof msg.value === 'number') {
                seekOnActiveTab(msg.value).then(success => {
                    relay.send({ type: MSG_TYPE.ACK, ok: success, action: "seeked"});
                });
            }
            break;
        case MSG_TYPE.VOLUME:
            if (typeof msg.value === 'number') {
                setVolumeOnActiveTab(msg.value).then(success => {
                    // No need to ACK
                });
            }
            break;
        case MSG_TYPE.PAIR_SUCCESS:
            logger.log("[bg] Pairing successful!");
            currentPairingToken = null; // Clear the token once pairing is done

            // Handle session token
            if (msg.sessionToken) {
                chrome.storage.local.set({ [SESSION_TOKEN_KEY]: msg.sessionToken }, () => {
                    logger.log("[bg] Session token saved.");
                    // Transition to the permanent room using the new token
                    relay.transitionToNewRoom(msg.sessionToken);
                });
            } else {
                // This logic handles all subsequent reconnections to an existing session room.
                // When we successfully connect to the permanent room and the remote joins,
                // the server sends a pair_success without a token. This is our signal to go "connected".
                relay._updateStatus("connected");
            }
            break;
        default:
            logger.log(`[bg] Message type is not recognized: ${msg.type}`);
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
relay.onFatalError(handleFatalRelayError);

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
                    logger.error("Failed to start pairing:", error);
                    relay.disconnect(); // Ensure we are in a clean state
                    sendResponse({ success: false, error: error.message });
                }
            })();
            return true; // Required for async sendResponse

        case MSG_TYPE.DISCONNECT_RELAY:
            currentPairingToken = null; // Clear the token once pairing is done
            // Also clear the stored session token
            chrome.storage.local.remove(SESSION_TOKEN_KEY, () => {
                logger.log("[bg] Session token cleared.");
            });
            relay.disconnect();
            sendResponse({ status: relay.getStatus() });
            break;

        case MSG_TYPE.GET_RELAY_STATUS:
            // Sends the token along with the status if pairing
            const status = relay.getStatus();
            const responsePayload = { status };
            if (status === "pairing" && currentPairingToken) {
                responsePayload.token = currentPairingToken;
            }
            sendResponse(responsePayload);
            break;
    }
    return true; // Keep message channel open for async responses
});

// Auto-connect on startup
chrome.runtime.onStartup.addListener(() => {
    logger.log('[bg] Browser startup detected.')
    chrome.storage.local.get(SESSION_TOKEN_KEY, (result) => {
        const token = result[SESSION_TOKEN_KEY];
        if (token) {
            logger.log(`[bg] Found session token: ${token}. Attempting to reconnect...`);
            relay.connect(token);
        } else {
            logger.log('[bg] No session token found.');
        }
    });
});