// webapp/script.js

// --- CONFIG & CONSTANTS ---
// IMPORTANT: Use your actual Cloudflare Tunnel URL here.
// Use 'wss://' for secure WebSockets, which is required for deployed sites.
const roomID = "THE_UUID_FROM_QR_CODE"
const RELAY_URL = `wss://relay.videocontrol.dev/ws?room=${roomID}&role=remote`;

const MSG_TYPE = {
  TOGGLE: "toggle",
  // We don't need the other types here yet, but it's good practice
};

// --- DOM ELEMENTS ---
const statusDiv = document.getElementById('status');
const toggleBtn = document.getElementById('toggleBtn');

// --- STATE ---
let ws = null;

// --- UI FUNCTIONS ---
function updateStatusUI(status) {
    statusDiv.textContent = `Status: ${status.charAt(0).toUpperCase() + status.slice(1)}`;
    statusDiv.className = ''; // Clear previous classes
    statusDiv.classList.add(`status-${status}`);
}

// --- WEBSOCKET LOGIC ---
function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.log("WebSocket is already connected or connecting.");
        return;
    }

    updateStatusUI('connecting');
    console.log("Attempting to connect to relay:", RELAY_URL);
    ws = new WebSocket(RELAY_URL);

    ws.onopen = () => {
        console.log("Successfully connected to the relay server!");
        updateStatusUI('connected');
    };

    ws.onmessage = (event) => {
        // We can listen for 'ack' messages from the extension here if we want
        console.log("Received message from relay:", event.data);
    };

    ws.onclose = () => {
        console.log("WebSocket connection closed. Attempting to reconnect...");
        updateStatusUI('disconnected');
        ws = null;
        // Simple exponential backoff could be added here, but for now, a fixed delay is fine.
        setTimeout(connect, 2000); // Try to reconnect after 2 seconds
    };

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        // The onclose event will be called automatically after an error,
        // which will trigger the reconnection logic.
        updateStatusUI('disconnected');
        ws.close(); // Ensure the socket is closed
    };
}

// --- EVENT LISTENERS ---
toggleBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = { type: MSG_TYPE.TOGGLE };
        console.log("Sending message:", message);
        ws.send(JSON.stringify(message));
    } else {
        console.warn("Cannot send message, WebSocket is not connected.");
        // Optionally, you could try to trigger a connection attempt here
        // connect();
    }
});

// --- INITIALIZATION ---
// Start the connection process as soon as the script loads
connect();