// --- CONFIG & CONSTANTS ---
const RELAY_URL = "ws://localhost:8080/ws?room=DEMO";
const RECONNECT_DELAY_MS = 1500;
const STORAGE_KEY_PLAYER_TAB_ID = "playerTabId";

const MSG_TYPE = {
  IDENTIFY: "client-identify",
  TOGGLE: "toggle",
  ACK: "ack",
};

// --- STATE ---
let ws = null;
let isConnecting = false;
const clientId = Math.random().toString(36).slice(2);


// --- WEBSOCKET MANAGEMENT ---

function connectToRelay() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return; // Already connected or connecting
  }
  if (isConnecting) return;
  isConnecting = true;

  console.log("[bg] Connecting to relay:", RELAY_URL);
  const sock = new WebSocket(RELAY_URL);

  sock.onopen = () => {
    console.log("[bg] Relay connected");
    isConnecting = false;
    ws = sock;
    ws.send(JSON.stringify({ type: MSG_TYPE.IDENTIFY, clientId }));
  };

  sock.onmessage = (event) => {
    handleRelayMessage(event.data);
  };

  sock.onclose = () => {
    console.log(`[bg] Relay closed. Retrying in ${RECONNECT_DELAY_MS}ms`);
    isConnecting = false;
    ws = null;
    setTimeout(connectToRelay, RECONNECT_DELAY_MS);
  };

  sock.onerror = (error) => {
    console.error("[bg] WebSocket error:", error);
    // onclose will be called next, triggering the reconnect logic
  };
}

function handleRelayMessage(data) {
  console.log("[bg] Relay message received:", data);
  let msg;
  try {
    msg = JSON.parse(data);
  } catch (e) {
    console.error("[bg] Failed to parse message:", data);
    return;
  }

  // Ignore messages broadcast by this client
  if (msg.clientId && msg.clientId === clientId) return;

  // Map message types to handler functions for scalability
  const messageHandlers = {
    [MSG_TYPE.TOGGLE]: handleToggleCommand,
    // Future commands can be added here:
    // [MSG_TYPE.PLAY]: handlePlayCommand,
    // [MSG_TYPE.PAUSE]: handlePauseCommand,
  };

  const handler = messageHandlers[msg.type];
  if (handler) {
    handler(msg);
  }
}

function sendToRelay(message) {
  // Optional chaining ?. ensures we don't crash if ws is null
  ws?.send?.(JSON.stringify({ ...message, clientId }));
}


// --- PLAYER & TAB CONTROL ---

async function getPlayerTabId() {
  const { [STORAGE_KEY_PLAYER_TAB_ID]: playerTabId } = await chrome.storage.local.get(STORAGE_KEY_PLAYER_TAB_ID);
  return playerTabId ?? null;
}

async function setPlayerTabId(tabId) {
  await chrome.storage.local.set({ [STORAGE_KEY_PLAYER_TAB_ID]: tabId });
}

async function executeInPlayerTab(func) {
  const tabId = await getPlayerTabId();
  if (!tabId) {
    sendToRelay({ type: MSG_TYPE.ACK, ok: false, error: "no-player-tab-set" });
    return;
  }

  try {
    // Check if the tab still exists before trying to execute a script
    await chrome.tabs.get(tabId);
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func,
    });
    return true; // Indicate success
  } catch (error) {
    // This error usually means the tab was closed
    console.warn(`[bg] Tab ${tabId} not found. Clearing it as player tab.`);
    await setPlayerTabId(null);
    sendToRelay({ type: MSG_TYPE.ACK, ok: false, error: "player-tab-missing" });
    return false; // Indicate failure
  }
}

// This is the function that will be injected into the page
function toggleLargestVideoOrAudio() {
  const mediaElements = [...document.querySelectorAll("video, audio")];
  if (mediaElements.length === 0) return;

  // Find the largest visible video element to control
  const largestMedia = mediaElements
    .sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];

  if (largestMedia.paused) {
    largestMedia.play().catch((e) => console.log("Play interrupted:", e.message));
  } else {
    largestMedia.pause();
  }
}

async function handleToggleCommand() {
  const success = await executeInPlayerTab(toggleLargestVideoOrAudio);
  if (success) {
    sendToRelay({ type: MSG_TYPE.ACK, ok: true, action: "toggled" });
  }
}


// --- CHROME EXTENSION EVENT LISTENERS ---

// Fired when the user clicks the extension's icon
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;
  await setPlayerTabId(tab.id);

  // Provide visual feedback to the user
  await chrome.action.setBadgeText({ text: "✓", tabId: tab.id });
  await chrome.action.setBadgeBackgroundColor({ color: "#1E9E1E", tabId: tab.id });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId: tab.id }), 1500);
});

// --- INITIALIZATION ---
connectToRelay();