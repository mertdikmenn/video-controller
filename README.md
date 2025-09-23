# Video Remote Control

[![Project Status: Complete](https://img.shields.io/badge/status-complete-brightgreen)](https://github.com/mertdikmenn/video-controller)

Turn your phone into a secure, real-time remote control for any video playing in your browser. This project provides a seamless and intuitive way to manage video playback from a distance, built with a robust, production-ready architecture.

## Demonstration

A quick look at the user experience, from pairing to control.

![Video Remote Control Demo](.github/assets/demo.gif)

## Key Features

-   📱 **Mobile-First Remote**: A clean, icon-based interface that feels like a native app.
-   🔒 **Secure QR Code Pairing**: No accounts or passwords needed. A simple, secure, and fast QR scan is all it takes to pair your devices.
-   🔄 **Persistent Sessions**: Reconnect to a previous session with a single tap. No need to re-scan every time you want to use the remote.
-   ⚡ **Real-Time Control**: Instantly control Play/Pause, Mute/Unmute, Volume, and Seeking (10s forward/backward).
-   🌐 **Works Everywhere**: Controls the largest `<video>` or `<audio>` element on the active tab, making it compatible with YouTube, Netflix, Vimeo, and more.
-   💪 **Reliable Backend**: Built with a lightweight and efficient Go server responsible for real-time message relaying.

## How It Works

The system is composed of three distinct parts that work in concert: a Chrome Extension (the Player), a Web App (the Remote), and a Go server (the Relay).

The pairing and connection process is designed for security and simplicity:

1.  **Token Generation**: The **Chrome Extension** requests a unique, short-lived (2-minute) pairing token from the **Go Relay Server**.
2.  **QR Code Display**: The extension displays this token as a QR code, which encodes a URL to the **Web App** (`app.videocontrol.dev/?pairToken=...`).
3.  **Initial Connection**: The user scans the QR code, opening the Web App. The app immediately uses the `pairToken` from the URL to connect to the Relay Server, joining a temporary room.
4.  **Pairing Confirmation**: Once both the Extension and the Web App are connected to the temporary room, the Relay Server confirms the pair.
5.  **Session Creation**: The server generates a new, long-lived **session token** and sends it to both clients.
6.  **Persistent Connection**: Both clients disconnect from the temporary room and immediately reconnect to a new, permanent room using the session token. The Extension saves this token in `chrome.storage`, and the Web App saves it in `localStorage`. This allows for the "Reconnect" functionality on future visits.

## How to Use It

1.  **Install the Extension**: Load the extension into your Chrome-based browser.
2.  **Open a Video**: Navigate to any webpage with a video you want to control (e.g., YouTube).
3.  **Generate Code**: Click the extension's icon in your browser toolbar and click "Generate Pairing Code".
4.  **Scan**: Use your phone's camera to scan the QR code that appears. This will open the remote control web app.
5.  **Control**: You're now connected! Use the buttons on your phone to control the video on your computer.

For future use, simply open the web app on your phone and tap the "Reconnect" button to resume your last session.

## Technical Details & Important Notes

-   **One-to-One Pairing**: Each player (extension) can only be paired with one remote at a time. Pairing a new remote will invalidate the previous session.
-   **Temporary Pairing Codes**: For security, a generated QR code is only valid for **2 minutes**. If you don't scan it in time, you will need to generate a new one.
-   **Session Persistence**: A paired session is long-lived, allowing you to reconnect easily. If you explicitly click "Disconnect" on the remote or clear your browser data, you will need to re-pair by scanning a new QR code.

## Technology Stack

| Component              | Technology                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Chrome Extension**   | JavaScript (ES Modules), HTML5, CSS3, Manifest V3, `chrome.scripting`, `chrome.storage`                     |
| **Web App (Remote)**   | Vanilla JavaScript (ES Modules), HTML5, CSS3, `html5-qrcode`, `navigator.vibrate`                           |
| **Backend (Relay)**    | Go (Golang), `net/http` for API, `github.com/coder/websocket` for real-time communication                     |
| **Infrastructure**     | Raspberry Pi 4 (Self-Hosted), Cloudflare Tunnel (for secure public access), `systemd` (for service management) |

---
## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
