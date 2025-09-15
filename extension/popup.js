import { MSG_TYPE } from './src/config.js';

document.addEventListener('DOMContentLoaded', () => {
    // Views
    const mainView = document.getElementById('main-view');
    const qrContainer = document.getElementById('qr-container');
    
    // Controls
    const generateBtn = document.getElementById('generateBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const statusDiv = document.getElementById('status');

    // This allows us to clear it or generate a new code in the same element.
    let qrCodeInstance = null;

    function updateStatusUI(status) {
        const validStatus = status || 'disconnected';
        statusDiv.textContent = `Status: ${validStatus.charAt(0).toUpperCase() + validStatus.slice(1)}`;
        statusDiv.className = '';
        statusDiv.classList.add(`status-${validStatus}`);

        if (validStatus === 'connected') {
            mainView.style.display = 'block';
            qrContainer.style.display = 'none';
            generateBtn.disabled = true;
            disconnectBtn.disabled = false;
            statusDiv.textContent = "Status: Paired & Connected";
        } else if (validStatus === 'pairing') { // NEW STATE
            mainView.style.display = 'none';
            qrContainer.style.display = 'block';
            disconnectBtn.disabled = false; // Allow user to cancel pairing
            statusDiv.textContent = "Status: Waiting for scan...";
            statusDiv.classList.remove('status-pairing'); // Use a different color
            statusDiv.classList.add('status-connecting'); // Reuse the orange color
        } else { // disconnected or connecting (before QR)
            mainView.style.display = 'block';
            qrContainer.style.display = 'none';
            generateBtn.disabled = (validStatus === 'connecting');
            disconnectBtn.disabled = true;
        }
    }

    function showQRCode(token) {
        // If an instance doesn't exist, create it.
        if (!qrCodeInstance) {
            qrCodeInstance = new QRCode(qrContainer, {
                text: token,
                width: 160,
                height: 160,
                colorDark: "#000000",
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
        } else {
            // If it already exists, just clear the old code and make a new one.
            qrCodeInstance.clear();
            qrCodeInstance.makeCode(token);
        }
    }

    // --- EVENT LISTENERS ---
    generateBtn.addEventListener('click', () => {
        statusDiv.textContent = "Status: Generating code...";
        generateBtn.disabled = true;

        chrome.runtime.sendMessage({ command: MSG_TYPE.START_PAIRING }, (response) => {
            if (chrome.runtime.lastError || !response.success) {
                console.error("Pairing failed:", response?.error || chrome.runtime.lastError?.message);
                updateStatusUI('disconnected');
                statusDiv.textContent = "Error: Could not get code.";
            } else {
                showQRCode(response.token);
            }
        });
    });

    disconnectBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ command: MSG_TYPE.DISCONNECT_RELAY });
        updateStatusUI('disconnected');
    });

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === MSG_TYPE.RELAY_STATUS_UPDATE && message.status) {
            updateStatusUI(message.status);
        }
    });

    // --- INITIALIZATION ---
    chrome.runtime.sendMessage({ command: MSG_TYPE.GET_RELAY_STATUS }, (response) => {
        if (response && response.status) {
            updateStatusUI(response.status);
        }
    });
});