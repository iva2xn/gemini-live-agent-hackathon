# Setting up NIBO

This guide will walk you through how to run NIBO locally and deploy its backend to Google Cloud.

The project is split into two parts:
1. **The Chrome Extension** (`/extension`): The frontend you install in Chrome.
2. **The FastAPI Backend** (`/server`): The Python server bridging the extension, Google Speech, and Google Cloud Vertex AI or Google AI Studio.

---

## 1. Local Backend Setup

You'll first need to set up the Python backend server so the Chrome extension has something to talk to.

### Prerequisites
- Python 3.10 or higher installed on your machine.
- A Google Cloud Project with the Vertex AI APIs enabled (if using Vertex AI mode) OR a Google AI Studio API Key.

### Installation
1. Open your terminal and navigate to the `server` directory:
   ```bash
   cd server
   ```
2. Create and activate a Python virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate  # On Windows, use `.venv\Scripts\activate`
   ```
3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure your environment variables:
   - Copy the example `.env` file (if provided) or create a new `.env` file in the `server/` directory.
   - It should contain the following:
     ```env
     # If TRUE, uses Vertex AI and ignores the API Key. If FALSE, uses the API Key.
     GOOGLE_GENAI_USE_VERTEXAI=TRUE 
     
     # Required if using Vertex AI
     GOOGLE_CLOUD_PROJECT=your-google-cloud-project-id
     GOOGLE_CLOUD_LOCATION=us-central1
     
     # Required if using Google AI Studio instead of Vertex AI
     GOOGLE_API_KEY=your-api-key-here
     ```

### Running the Local Server (Development)
If you wish to test NIBO locally before deploying it to the cloud:
1. Make sure you are in the `server/` directory and your virtual environment is activated.
2. If you are using Vertex AI (`GOOGLE_GENAI_USE_VERTEXAI=TRUE`), authenticate your terminal with Google Cloud:
   ```bash
   gcloud auth application-default login
   ```
3. Run the FastAPI server:
   ```bash
   python3 main.py
   ```
   *The server will start running on `ws://localhost:8080/ws`.*

---

## 2. Chrome Extension Setup

Once your backend is running (or deployed), install the frontend extension in Chrome.

1. Open Google Chrome and go to `chrome://extensions/`.
2. Turn on the **Developer mode** toggle in the top right corner.
3. Click the **Load unpacked** button in the top left.
4. Select the `extension/` folder from this repository.
5. The NIBO extension icon should now appear in your browser toolbar!

*Note: By default, the extension's `offscreen.js` file is configured pointing to a cloud URL. If you are running the backend locally, you must open `extension/offscreen.js` and change the WebSocket URL on line 37 from `wss://nibo-backend-...` to `ws://localhost:8080/ws`.*

---

## 3. Deploying to Google Cloud Run (Production)

To make NIBO available anywhere without keeping your terminal open, you can deploy the backend to Google Cloud Run. This project includes a handy script for this.

### Prerequisites
- Google Cloud SDK (`gcloud`) installed on your machine.
- A Google Cloud Project with a linked Billing Account.
- The following APIs enabled on your GCP Project: Vertex AI API, Cloud Build API, Artifact Registry API, Cloud Run Admin API.

### Deployment Steps
1. Navigate to the `server` folder in your terminal:
   ```bash
   cd server
   ```
2. Make sure you are authenticated with Google Cloud and your CLI paths are set:
   ```bash
   export PATH=$PATH:~/google-cloud-sdk/bin
   gcloud auth login
   gcloud config set project your-google-cloud-project-id
   ```
3. Run the provided deployment script:
   ```bash
   ./deploy.sh
   ```
   *The script will automatically build a Docker container, push it to Artifact Registry, and deploy the service to Cloud Run. When it finishes, it will print out a public URL (e.g., `https://nibo-backend-xyz.run.app`).*

4. **Update the Extension:** Copy the URL provided by the deployment script, change `https` to `wss`, and update the `WebSocket` URL inside `extension/offscreen.js`. Reload the extension in Chrome, and you are good to go!
