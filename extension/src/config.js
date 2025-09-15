export const RELAY_URL = "wss://relay.videocontrol.dev/ws?room=DEMO";
export const RECONNECT_DELAY_MS = 2000

export const MSG_TYPE = {
    IDENTIFY: "client-identify",
    TOGGLE: "toggle",
    ACK: "ack",
    CONNECT_RELAY: "connectRelay",
    DISCONNECT_RELAY: "disconnectRelay",
    GET_RELAY_STATUS: "getRelayStatus",
    RELAY_STATUS_UPDATE: "relayStatusUpdate",
};
