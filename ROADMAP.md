# ROADMAP.md: NIBO Implementation Strategy

This implementation is divided into two distinct clusters: **Development & Testing** (Local/Free) and **Production & Deployment** (Cloud/Vertex).

---

## Cluster 1: Development & Testing
Goal: Rapidly build the "Core Magic" of the autopilot using local tools and free-tier APIs.

### Phase 1: Local Audio Bridge
- **1.1 Extension Offscreen**: Setup binary microphone capture in `offscreen.js`.
- **1.2 Audio Resampling**: Implement browser-side 44.1kHz -> 16kHz Mono conversion.
- **1.3 Local Relay**: Build a Node.js WebSocket server to receive raw audio chunks.

### Phase 2: Gemini AI Studio (Free-Tier) Integration
- **2.1 AI Studio Link**: Authenticate using `@google/generative-ai` SDK.
- **2.2 Real-time Conversation**: Establish the first low-latency voice loop (User -> Server -> Gemini -> User).
- **2.3 Intent Validation**: Fine-tune the system prompt for "Natural Language Driven" web commands.

### Phase 3: Browser Autopilot (Local Orchestration)
- **3.1 DOM Distillation**: Create the content script that "simplifies" the webpage for AI consumption.
- **3.2 Action Engine**: Map AI tool calls (clicks, typing, navigation) to the extension's execution script.
- **3.3 Success Loop**: Verify the system can execute a multi-step task (e.g., "Add a laptop to my Amazon cart").

---

## Cluster 2: Production & Deployment
Goal: Hardening the system for the final submission using Google Cloud infrastructure.

### Phase 4: Cloud Infrastructure (The "Bouncer")
- **4.1 Containerization**: Create a `Dockerfile` optimized for Google Cloud Run.
- **4.2 Automated CI/CD**: Setup GitHub Actions for "Push-to-Deploy" functionality.
- **4.3 Secure Secrets**: Move API keys from environment variables to Google Secret Manager.

### Phase 5: Vertex AI Production Migration
- **5.1 Vertex API Swap**: Transition from AI Studio SDK to the Vertex AI SDK for production stability.
- **5.2 IAM Security**: Configure Workload Identity so Cloud Run talks to Gemini via Service Accounts (no keys needed).
- **5.3 Scaling Optimization**: Adjust Cloud Run concurrency and memory for low-latency audio processing.

### Phase 6: Final Safety & Localization
- **6.1 Ambient Guardian**: Implement the background audio scanner for social engineering detection.
- **6.2 Workflow Persistence**: Save successful automation "Macros" locally in `chrome.storage.local` for instant replay.
- **6.3 Red Alert UI**: Finalize the browser-wide "Block" overlay when an external threat is detected.
