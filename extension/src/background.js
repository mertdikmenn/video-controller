import { RELAY_URL, MSG_TYPE } from './config.js';
import { RelayConnection } from './relay-connection.js';
import { togglePlaybackOnActiveTab } from './player-control.js';

// --- INITIALIZATION ---

const relay = new RelayConnection(RELAY_URL);

// --- LOGIC ---

function handleRelayMessage(msg) {
    console.log("[bg] Received message from relay:", msg);
    switch (msg.type) {
        case MSG_TYPE.TOGGLE:
            togglePlaybackOnActiveTab().then(success => {
                relay.send({ type: MSG_TYPE.ACK, ok: success, action: "toggled"});
            });
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
        case MSG_TYPE.CONNECT_RELAY:
            relay.connect();
            sendResponse({ status: relay.getStatus() });
            break;
        case MSG_TYPE.DISCONNECT_RELAY:
            relay.disconnect();
            sendResponse({ status: relay.getStatus() });
            break;
        case MSG_TYPE.RELAY_STATUS_UPDATE:
            sendResponse({ status: relay.getStatus() });
            break
    }
    return true
});