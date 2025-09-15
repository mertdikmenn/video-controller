import { MSG_TYPE, RECONNECT_DELAY_MS } from './config.js';

export class RelayConnection {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.roomID = null;
        this.ws = null;
        this.status = "disconnected";
        this.isConnecting = false;
        this.reconnectTimeoutId = null;
        this.clientId = Math.random().toString(36).slice(2);
        this.onMessageCallback = () => {};
        this.onStatusChangeCallback = () => {};
    }


    // --- Public Methods ---

    connect(roomID) {
        if (this.ws || this.isConnecting) {
            console.warn("[Relay] Connection attempt ignored: already connected or connecting.");
            return;
        }
        this.roomID = roomID; // Store the roomID for reconnects
        this._doConnect();
    }

    disconnect() {
        console.log("[Relay] User initiated disconnect.");
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

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ ...message, clientId: this.clientId }));
        } else {
            console.warn("[Relay] Not connected, message not sent:", message);
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

    // --- Private Methods ---

    _updateStatus(newStatus) {
        if (this.status === newStatus)
            return;

        this.status = newStatus;
        console.log(`[Relay] Status changed to: ${newStatus}`);
        this.onStatusChangeCallback(newStatus);
    }

    _doConnect() {
        if (!this.roomID) {
            console.error("[Relay] Cannot connect without a roomID.");
            return;
        }
        clearTimeout(this.reconnectTimeoutId);
        this.isConnecting = true;
        this._updateStatus("connecting");

        const urlWithParams = `${this.baseUrl}?room=${this.roomID}&role=player`;
        console.log(`[Relay] Attempting to connect to: ${urlWithParams}`);
        const sock = new WebSocket(urlWithParams);

        sock.onopen = () => {
            console.log("[Relay] Connected");
            this.isConnecting = false;
            this.ws = sock;
            this._updateStatus("connected");
            this.send({ type: MSG_TYPE.IDENTIFY });
        };

        sock.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.clientId && msg.clientId === this.clientId) return;
                this.onMessageCallback(msg);
            } catch (e) {
                console.error("[Relay] Failed to parse message:", event.data);
            }
        };

        sock.onclose = () => {
            console.log(`[Relay] Connection closed. Current status: ${this.status}`);
            this.isConnecting = false;
            this.ws = null;
            if (this.status === "connected" || this.status === "connecting") {
                this._updateStatus("disconnected");
                console.log(`[Relay] Attempting reconnect in ${RECONNECT_DELAY_MS}ms...`);
                this.reconnectTimeoutId = setTimeout(() => this._doConnect(), RECONNECT_DELAY_MS);
            }
        };

        sock.onerror = (error) => {
            console.error("[Relay] WebSocket error:", error);
            this.isConnecting = false;
            // onclose will be called next, which handles the state change and reconnect logic.
        };
    }

}