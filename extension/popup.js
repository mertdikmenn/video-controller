import { MSG_TYPE } from './src/config.js';

document.addEventListener('DOMContentLoaded', () => {
    const connectBtn = document.getElementById('connectBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const statusDiv = document.getElementById('status');

    /**
     * Updates the popup's UI based on the connection status.
     * @param {string} status - The connection status ("connected", "connecting", "disconnected").
     */
    function updateStatusUI(status) {
        // Sanitize status just in case
        const validStatus = status || 'disconnected';

        statusDiv.textContent = `Status: ${validStatus.charAt(0).toUpperCase() + validStatus.slice(1)}`;
        statusDiv.className = ''; // Clear previous classes
        statusDiv.classList.add(`status-${validStatus}`);

        // Update button states based on the connection status
        connectBtn.disabled = (validStatus === 'connected' || validStatus === 'connecting');
        disconnectBtn.disabled = (validStatus === 'disconnected');
    }

    /**
     * Sends a command to the background service worker.
     * @param {string} command - The command to send (e.g., MSG_TYPE.CONNECT_RELAY).
     */
    function sendCommand(command) {
        chrome.runtime.sendMessage({ command }, (response) => {
            // After the command is processed, update the UI with the confirmed status
            if (chrome.runtime.lastError) {
                console.error(`Error sending command "${command}":`, chrome.runtime.lastError.message);
                updateStatusUI('disconnected'); // Assume failure if there's an error
            } else if (response && response.status) {
                updateStatusUI(response.status);
            }
        });
    }

    // --- EVENT LISTENERS ---
    
    connectBtn.addEventListener('click', () => {
        updateStatusUI("connecting");
        sendCommand(MSG_TYPE.CONNECT_RELAY);
    });

    disconnectBtn.addEventListener('click', () => {
        updateStatusUI("disconnected");
        sendCommand(MSG_TYPE.DISCONNECT_RELAY)
    });

    // Listen for real-time status updates from the background script.
    // This is crucial for when the connection drops while the popup is open.
    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === MSG_TYPE.RELAY_STATUS_UPDATE && message.status) {
            updateStatusUI(message.status);
        }
    });

    // --- INITIALIZATION ---

    // Request the initial status from the background script when the popup opens.
    sendCommand(MSG_TYPE.GET_RELAY_STATUS);
});
