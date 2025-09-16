// --- CONFIG & CONSTANTS
const WEBSOCKET_BASE_URL = "wss://relay.videocontrol.dev/ws"

const MSG_TYPE = {
    TOGGLE: "toggle",
    PAIR_SUCCESS: "pair_success",
}

// --- DOM ELEMENTS ---
const statusDiv = document.getElementById("status");
const initialView = document.getElementById("initial-view");
const controlsView = document.getElementById("controls");
const scanBtn = document.getElementById("scanBtn");
const toggleBtn = document.getElementById("toggleBtn");
const qrReaderDiv = document.getElementById("qr-reader");

// --- STATE ---
let ws = null;
const html5QrCode = new Html5Qrcode("qr-reader");

// --- UI FUNCTIONS ---
function updateStatusUI(status, message) {
    statusDiv.textContent = `Status: ${message || status.charAt(0).toUpperCase() + status.slice(1)}`;
    statusDiv.className = '';
    statusDiv.classList.add(`status-${status}`);
}

function showView(view) {
    initialView.style.display = 'none';
    controlsView.style.display = 'none';
    qrReaderDiv.style.display = 'none';

    if (view == "initial")
        initialView.style.display = "block";
    if (view == "controls")
        controlsView.style.display = "block";
    if (view == "scanner")
        qrReaderDiv.style.display = "block";
}

// --- WEBSOCKET LOGIC ---
function connect(roomID) {
    if (ws)
        return;

    const fullUrl = `${WEBSOCKET_BASE_URL}?room=${roomID}&role=remote`;
    updateStatusUI("connecting");
    console.log("Attempting to connect to relay:", fullUrl);
    ws = new WebSocket(fullUrl);

    ws.onopen = () => {
        console.log("WebSocket opened. Waiting for pairing confirmation...");
        // We don't change status to 'connected' here. We wait for the server.
    };

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        console.log("Received message:", msg);
        if (msg.type === MSG_TYPE.PAIR_SUCCESS) {
            console.log("Pairing successfull!");
            updateStatusUI('connected', 'Paired & Connected');
            showView('controls');
        }
    };

    ws.onclose = () => {
        console.log("WebSocket connection closed.");
        updateStatusUI("disconnected");
        showView("initial");
        ws = null;
    }

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        updateStatusUI('disconnected', 'Connection Error');
        showView('initial');
        ws = null;
    };
}

// --- QR SCANNER LOGIC ---
const onScanSuccess = (decodedText, decodedResult) => {
    console.log(`QR Code scanned, token: ${decodedText}`);

    // Stop the camera
    html5QrCode.stop().then(() => {
        console.log("QR scanning stopped.");
        showView('initial'); // Hide the scanner view
        // Connect to the WebSocket with the scanned token
        connect(decodedText);
    }).catch(err => {
        console.error("Failed to stop QR scanner:", err);
    });
};

const onScanFailure = (error) => {
    // This callback is called frequently, so we don't log anything here
    // to avoid spamming the console.
};

const startScanner = () => {
    showView('scanner');
    updateStatusUI('connecting', 'Scanning...');

    const config = { fps: 10, qrbox: { width: 250, height: 250 } };
    // Use "environment" to prefer the back camera on mobile
    html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, onScanFailure)
        .catch(err => {
            console.error("Unable to start scanning.", err);
            updateStatusUI("disconnected", "Camera Error");
            showView('initial');
        });
};

// --- EVENT LISTENERS ---
scanBtn.addEventListener('click', startScanner);

toggleBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MSG_TYPE.TOGGLE }));
    } else {
        console.warn("Cannot send message, WebSocket is not connected.");
    }
});

// --- INITIALIZATION ---
showView('initial');