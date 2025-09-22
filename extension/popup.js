import { MSG_TYPE } from './src/config.js';
import { logger } from './src/logger.js';

const WEBAPP_URL = "https://app.videocontrol.dev";

document.addEventListener('DOMContentLoaded', () => {
    // Views
    const mainView = document.getElementById('main-view');
    const qrContainer = document.getElementById('qr-container');
    const cancelView = document.getElementById('cancel-view');
    
    // Controls
    const generateBtn = document.getElementById('generateBtn');
    const disconnectBtn = document.getElementById('disconnectBtn');
    const cancelPairingBtn = document.getElementById('cancelPairingBtn');
    const statusDiv = document.getElementById('status');

    let qrCodeInstance = null;

    function updateStatusUI(status) {
        const validStatus = status || 'disconnected';
        statusDiv.textContent = `Status: ${validStatus.charAt(0).toUpperCase() + validStatus.slice(1)}`;
        statusDiv.className = '';
        statusDiv.classList.add(`status-${validStatus}`);

        // Hide all views by default for cleaner state management
        mainView.style.display = 'none';
        qrContainer.style.display = 'none';
        cancelView.style.display = 'none';

        if (validStatus === 'connected') {
            mainView.style.display = 'block';
            generateBtn.disabled = true;
            disconnectBtn.disabled = false;
            statusDiv.textContent = "Status: Paired & Connected";
        } else if (validStatus === 'pairing') {
            qrContainer.style.display = 'block';
            cancelView.style.display = 'block'; // Show the cancel button
            statusDiv.textContent = "Status: Waiting for scan...";
            statusDiv.classList.remove('status-pairing');

            statusDiv.classList.add('status-connecting');
        } else { // disconnected or connecting (before QR)
            mainView.style.display = 'block';
            generateBtn.disabled = (validStatus === 'connecting');
            disconnectBtn.disabled = true;
        }
    }

    function showQRCode(token) {
        const pairingUrl = `${WEBAPP_URL}/?pairToken=${token}`;
        logger.log(`[popup] Generating QR code for URL: ${pairingUrl}`);

        qrContainer.innerHTML = ''; 
        qrCodeInstance = new QRCode(qrContainer, {
            text: pairingUrl,
            width: 160,
            height: 160,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });
    }

    // --- EVENT LISTENERS ---
    generateBtn.addEventListener('click', () => {
        statusDiv.textContent = "Status: Generating code...";
        generateBtn.disabled = true;

        chrome.runtime.sendMessage({ command: MSG_TYPE.START_PAIRING }, (response) => {
            if (chrome.runtime.lastError || !response.success) {
                logger.error("Pairing failed:", response?.error || chrome.runtime.lastError?.message);
                updateStatusUI('disconnected');
                statusDiv.textContent = "Error: Could not get code.";
            } else {
                showQRCode(response.token);
                updateStatusUI('pairing');
            }
        });
    });

    // This function will be used by both disconnect buttons
    const handleDisconnect = () => {
        chrome.runtime.sendMessage({ command: MSG_TYPE.DISCONNECT_RELAY });
        updateStatusUI('disconnected');
    };

    disconnectBtn.addEventListener('click', handleDisconnect);
    cancelPairingBtn.addEventListener('click', handleDisconnect);

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === MSG_TYPE.RELAY_STATUS_UPDATE && message.status) {
            updateStatusUI(message.status);
        }
    });

    // --- INITIALIZATION ---
    chrome.runtime.sendMessage({ command: MSG_TYPE.GET_RELAY_STATUS }, (response) => {
        if (chrome.runtime.lastError) {
            logger.error(chrome.runtime.lastError.message);
            updateStatusUI('disconnected');
            return;
        }
        if (response && response.status) {
            updateStatusUI(response.status);
            if (response.status === 'pairing' && response.token) {
                showQRCode(response.token);
            }
        }
    });
});