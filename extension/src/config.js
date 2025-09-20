const BASE_URL = "wss://relay.videocontrol.dev";

export const API_GENERATE_TOKEN_URL = "https://relay.videocontrol.dev/api/generate-token";
export const WEBSOCKET_URL = `${BASE_URL}/ws`;

export const RECONNECT_DELAY_MS = 2000;

export const MSG_TYPE = {
    IDENTIFY: "client-identify",
    TOGGLE: "toggle",
    MUTE: "mute",
    SEEK: "seek",
    ACK: "ack",
    PAIR_SUCCESS: "pair_success",
    START_PAIRING: "startPairing",
    DISCONNECT_RELAY: "disconnectRelay",
    GET_RELAY_STATUS: "getRelayStatus",
    RELAY_STATUS_UPDATE: "relayStatusUpdate",
};
