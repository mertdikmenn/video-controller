// --- CONFIG & CONSTANTS
const WEBSOCKET_BASE_URL = "wss://relay.videocontrol.dev/ws"
const SESSION_TOKEN_KEY = 'sessionToken';

const MSG_TYPE = {
    TOGGLE: "toggle",
    MUTE: "mute",
    SEEK: "seek",
    VOLUME: "volume",
    PAIR_SUCCESS: "pair_success",
}

// --- DOM ELEMENTS ---
const statusDiv = document.getElementById("status");
const initialView = document.getElementById("initial-view");
const controlsView = document.getElementById("controls");
const scanBtn = document.getElementById("scanBtn");
const toggleBtn = document.getElementById("toggleBtn");
const muteBtn = document.getElementById("muteBtn");
const seekBackwardBtn = document.getElementById("seekBackwardBtn");
const seekForwardBtn = document.getElementById("seekForwardBtn");
const volumeSlider = document.getElementById("volumeSlider");
const disconnectBtn = document.getElementById("disconnectBtn");
const reconnectBtn = document.getElementById("reconnectBtn");
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
function disconnect() {
    if (ws) {
        ws.onclose = null; // Prevent onclose handler from firing
        ws.close();
        ws = null;
    }
    updateStatusUI("disconnected");
    showView("initial");
    // After disconnecting, re-run initialize to check if we should show the reconnect button
    initializeUI();
}

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
            // This is the INITIAL pairing, server sent us a permanent token
            if (msg.sessionToken) {
                console.log("Received session token. Storing and reconnecting...");
                localStorage.setItem(SESSION_TOKEN_KEY, msg.sessionToken);
                
                disconnect();
                setTimeout(() => connect(msg.sessionToken), 100); // Small delay
 
            } else {
                // This is a RECONNECTION confirmation
                console.log("Pairing successfull!");
                updateStatusUI('connected', 'Paired & Connected');
                showView('controls');
            }
        }
    };

    ws.onclose = (event) => {
        console.log(`WebSocket connection closed. Code: ${event.code}`);
        ws = null;

        if (event.code == 4001) {
            console.log("Session token is invalid. Clearing it.");
            localStorage.removeItem(SESSION_TOKEN_KEY);
            updateStatusUI("disconnected", "Session expired. Please scan again.");
        } else {
            updateStatusUI("disconnected");
        }

        showView("initial");
        initializeUI();
    }

    ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        updateStatusUI('disconnected', 'Connection Error');
        // onclose will handle the rest
    };
}

// --- QR SCANNER LOGIC ---
const onScanSuccess = (decodedText, decodedResult) => {
    console.log(`QR Code scanned, token: ${decodedText}`);
    let token = decodedText;

    // Handle the case where the scanned content is a full URL
    try {
        const url = new URL(decodedText);
        const pairTokenFromUrl = url.searchParams.get('pairToken');
        if (pairTokenFromUrl) {
            console.log("Extracted pairToken from scanned URL.");
            token = pairTokenFromUrl;
        }
    } catch (e) {
        // Not a valid URL, assume it's a raw token for backward compatibility.
        console.log("Scanned content is not a URL, treating as raw token.");
    }

    // Stop the camera
    html5QrCode.stop().then(() => {
        console.log("QR scanning stopped.");
        showView('initial'); // Hide the scanner view
        // Connect to the WebSocket with the scanned token
        connect(token);
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
scanBtn.addEventListener('click', () => {
    // Force a clean state before starting a new pairing process.
    console.log("Starting a new scan. Clearing previous session.");
    disconnect(); // This closes any existing WebSocket and resets the UI.

    startScanner();
});

reconnectBtn.addEventListener('click', () => {
    const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
    if (sessionToken) {
        console.log(`Attempting to reconnect with token: ${sessionToken}`);
        connect(sessionToken);
    } else {
        console.warn("Reconnect clicked but no session token found.");
        // This case is unlikely as the button should be hidden, but it's good practice.
        initializeUI(); 
    }
});

toggleBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MSG_TYPE.TOGGLE }));
    } else {
        console.warn("Cannot send message, WebSocket is not connected.");
    }
});

muteBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: MSG_TYPE.MUTE }))
    } else {
        console.warn("Cannot send message, WebSocket is not connected.");
    }
});

seekBackwardBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Send the seek command with a negative value
        ws.send(JSON.stringify({ type: MSG_TYPE.SEEK, value: -10 }));
    } else {
        console.warn("Cannot send message, WebSocket is not connected.");
    }
});

seekForwardBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // Send the seek command with a positive value
        ws.send(JSON.stringify({ type: MSG_TYPE.SEEK, value: 10 }));
    } else {
        console.warn("Cannot send message, WebSocket is not connected.");
    }
});

function throttle(func, limit) {
    let inThrottle;
    return function() {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    }
}

function sendVolumeUpdate() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const volumeLevel = volumeSlider.value / 100;
        ws.send(JSON.stringify({ type: MSG_TYPE.VOLUME, value: volumeLevel }));
    } else {
        console.warn("Cannot send message, WebSocket is not connected.");
    }
}

volumeSlider.addEventListener('input', throttle(sendVolumeUpdate, 100)); // Update at most every 100ms

disconnectBtn.addEventListener('click', () => {
    console.log("User initiated disconnect.");
    disconnect()
});


// --- INITIALIZATION ---
function cleanUrl() {
    const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
    window.history.replaceState({ path: newUrl }, '', newUrl);
}

function initializeApp() {
    // Priority 1: Check for a new pairing token in the URL.
    const urlParams = new URLSearchParams(window.location.search);
    const pairToken = urlParams.get("pairToken");

    if (pairToken) {
        console.log(`Found pairToken in URL: ${pairToken}. Starting new pairing process.`);

        // Clean the URL so a page refresh doesn't re-trigger the pairing.
        cleanUrl();

        // This is a new pairing, so clear any old session immediately.
        localStorage.removeItem(SESSION_TOKEN_KEY);

        // Immediately connect with the new token.
        connect(pairToken);
        return; // Stop further execution.
    }

    // Priority 2: No pairToken in the URL, so proceed with the normal UI setup.
    initializeUI();
}

function initializeUI() {
    const sessionToken = localStorage.getItem(SESSION_TOKEN_KEY);
    if (sessionToken) {
        console.log(`Found session token: ${sessionToken}. Showing reconnect option.`);
        reconnectBtn.style.display = 'block';
    } else {
        console.log("No session token found. Waiting for user to scan.");
        reconnectBtn.style.display = 'none';
    }
    showView('initial');
}

initializeApp();