# NIBO Setup Guide

## 1. Quick Start (Local)
1. **Prepare Server:**
   ```bash
   cd server
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   gcloud auth application-default login
   python main.py
   ```
2. **Install Extension:**
   - Open `chrome://extensions/`
   - Enable **Developer Mode**
   - Click **Load Unpacked** and select the `/extension` folder.
3. **Local Pointing:**
   - In `extension/offscreen.js`, ensure the WebSocket URL points to: `ws://localhost:8080/ws`.

## 2. Production Deployment
1. **Deploy to Cloud Run:**
   ```bash
   cd server
   gcloud auth login
   gcloud config set project live-agents-hackathon
   ./deploy.sh
   ```
2. **Post-Deploy:**
   - Copy the `https://...` URL from the terminal output.
   - Update `extension/offscreen.js` with the new `wss://...` URL.
   - Reload the extension in Chrome.

## 3. Monitoring
View live traffic and console logs:
```bash
gcloud beta run services logs tail nibo-backend --project live-agents-hackathon
```
