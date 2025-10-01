import { MSG_TYPE, RECONNECT_DELAY_MS } from './config.js';
import { logger } from './logger.js';

// Add a PING message type to the config
const PING_MSG = JSON.stringify({ type: 'ping' });
const PING_INTERVAL_MS = 25000; // 25 seconds

export class RelayConnection {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.roomID = null;
        this.ws = null;
        this.status = "disconnected";
        this.isConnecting = false;
        this.reconnectTimeoutId = null;
        this.pingIntervalId = null;
        this.clientId = Math.random().toString(36).slice(2);
        this.onMessageCallback = () => {};
        this.onStatusChangeCallback = () => {};
    }

    _startPing() {
        this._stopPing();
        this.pingIntervalId = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(PING_MSG)
            }
        }, PING_INTERVAL_MS);
    }

    _stopPing() {
        clearInterval(this.pingIntervalId);
        this.pingIntervalId = null;
    }

    // --- Public Methods ---

    connect(roomID) {
        if (this.ws || this.isConnecting) {
            logger.warn("[Relay] Connection attempt ignored: already connected or connecting.");
            return;
        }
        this.roomID = roomID; // Store the roomID for reconnects
        this._doConnect();
    }

    disconnect() {
        logger.log("[Relay] User initiated disconnect.");
        this._stopPing();
        this.roomID = null; // Clear the roomID
        this._updateStatus("disconnected");
        clearTimeout(this.reconnectTimeoutId);
        this.reconnectTimeoutId = null;
        this.isConnecting = false;
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    transitionToNewRoom(newRoomID) {
        logger.log(`[Relay] Transitioning to new room: ${newRoomID}`);
        this._stopPing(); // Stop pinging during transition

        // 1. Update the roomID for future automatic reconnections
        this.roomID = newRoomID;

        // 2. Close the old connection (to the temporary room)
        if (this.ws) {
            // We remove the onclose handler temporarily to prevent the
            // automatic reconnect logic from firing with the OLD roomID.
            this.ws.onclose = null;
            this.ws.close();
            this.ws = null;
        }
        
        // 3. Immediately connect to the new room
        this._doConnect();
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ...message, clientId: this.clientId }));
        } else {
            logger.warn("[Relay] Not connected, message not sent:", message);
        }
    }

    getStatus() {
        return this.status;
    }

    onMessage(callback) {
        this.onMessageCallback = callback;
    }

    onStatusChange(callback) {
        this.onStatusChangeCallback = callback;
    }

    onFatalError(callback) {
        this.onFatalErrorCallback = callback;
    }

    // --- Private Methods ---

    _updateStatus(newStatus) {
        if (this.status === newStatus)
            return;

        this.status = newStatus;
        logger.log(`[Relay] Status changed to: ${newStatus}`);
        this.onStatusChangeCallback(newStatus);
    }

    _doConnect() {
        if (!this.roomID) {
            logger.error("[Relay] Cannot connect without a roomID.");
            return;
        }
        clearTimeout(this.reconnectTimeoutId);
        this.isConnecting = true;
        this._updateStatus("connecting");

        const urlWithParams = `${this.baseUrl}?room=${this.roomID}&role=player`;
        logger.log(`[Relay] Attempting to connect to: ${urlWithParams}`);

        try {
            const sock = new WebSocket(urlWithParams);

            sock.onopen = () => {
                logger.log("[Relay] WebSocket opened. Waiting for pairing.");
                this.isConnecting = false;
                this.ws = sock;
                // CRITICAL CHANGE: The connection is open, but we are not "Connected" yet.
                // We are now in a "pairing" state, waiting for the server to confirm.
                this._updateStatus("pairing"); 
                this.send({ type: MSG_TYPE.IDENTIFY });
                this._startPing(); // Start the keepalive ping
            };

            sock.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.clientId && msg.clientId === this.clientId) return;
                    this.onMessageCallback(msg);
                } catch (e) {
                    logger.error("[Relay] Failed to parse message:", event.data);
                }
            };

            sock.onclose = () => {
                logger.log(`[Relay] Connection closed. Current status: ${this.status}`);
                this.isConnecting = false;
                this._stopPing(); // Stop pinging when connection closes
                this.ws = null;
                // Only try to reconnect if we have a roomID (i.e., not a user-initiated disconnect)
                if (this.roomID && (this.status === "connected" || this.status === "pairing")) {
                    this._updateStatus("disconnected");
                    logger.log(`[Relay] Attempting reconnect in ${RECONNECT_DELAY_MS}ms...`);
                    this.reconnectTimeoutId = setTimeout(() => this._doConnect(), RECONNECT_DELAY_MS);
                } else {
                    this._updateStatus("disconnected");
                }
            };

            sock.onerror = (error) => {
                logger.error("[Relay] WebSocket error:", error);
                this.isConnecting = false;
                // onclose will be called next, which handles the state change and reconnect logic.
            };
        } catch (error) {
            logger.log("[Relay] WebSocket handshake failed. Likely an expired session.", error.message);
            this.isConnecting = false;
            
            // Signal to background script to clean up the session token
            this.onFatalErrorCallback();
            
            // Perform a clean disconnect on our end
            this.disconnect();
        }
    }

}