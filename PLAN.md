# PLAN.md: Neural-Interface Browser Orchestrator (NIBO)

# 1. Executive Summary
Development of a distributed browser orchestration runtime leveraging the **Gemini 2.5 Flash Multimodal Live API** for real-time native audio intent parsing and DOM manipulation. 

NIBO utilizes a **One-Shot Heuristic Engine** to serialize non-deterministic model outputs into stable, locally-persistent navigation primitives. Simultaneously, an **Ambient Instruction Guardian** monitors environmental telemetry via a real-time WebSocket pipeline to Vertex AI, providing out-of-band security intercepts and DOM-level mitigation for social engineering threats.

---

# 2. Hybrid Architecture

### 2.1 Inference & Intelligence
*   **Inference Engine:** **Gemini 2.5 Flash (Multimodal Live API)** via Vertex AI. Handles raw native audio streams with sub-second latency for intent verification and safety skimming.
*   **Cloud Orchestration:** **Google Cloud Run**. A containerized backend manages the secure WebSocket handshake and proxies audio streams to the Vertex AI environment.

### 2.2 Extension Core (Client-Side)
*   **Local Persistence:** `chrome.storage.local`. Stores vectorized workflow maps, "Deep Links," and user-defined macros. This ensures **Zero-Latency** playback and **Maximum Privacy** (no workflow data is stored on external servers).
*   **Event Ingestion:** `chrome.commands` (Hardware Trigger) & `chrome.offscreen` (Continuous PCM Audio Capture).
*   **Privacy Shield:** Local **PII Redaction Engine** (Regex-based scrubbing of sensitive data like CC numbers or IDs before audio/metadata egress).
*   **Execution Agent:** `chrome.scripting` for high-fidelity DOM interaction and synthetic event dispatching.

---

# 3. Technical Implementation Roadmap

## Phase 1: Zero-Shot Intent & Safety Verification
*Goal: Authenticate the instruction, scrub private data, and execute the first run.*

### 1.1 Trigger & PII Redaction
*   **Input:** User/Ambient Audio -> Captured via `offscreen.html`.
*   **Privacy Filter:** Before egress to the cloud, the client-side script executes a **PII Redaction Pass**. Any strings matching sensitive patterns (CC, SSN, Account IDs) are scrubbed from the metadata.
*   **Security Gating:** Gemini 2.5 Flash skims the intent for malicious patterns (e.g., "Download remote access software"). If flagged, the process is terminated at the edge.

### 1.2 DOM Distillation & Interaction
*   **Step 1 (Scan):** Content Script scans the DOM, stripping all framework-specific noise (React/Vue/Angular classes).
*   **Step 2 (Filter):** Filters for **Accessibility Landmarks** (`role`, `aria-label`, `placeholder`).
*   **Step 3 (Act):** Gemini identifies the target ID based on the distilled JSON. The extension simulates a human user via `InputEvent` and `KeyboardEvent` dispatching to ensure the website's internal state updates correctly.

---

## Phase 2: One-Shot Macro Creation (Local Persistence)
*Goal: Convert a successful manual execution into a permanent, locally-stored macro.*

### 2.1 Success State Serialization
*   **Trigger:** Successful arrival at a "Goal State" (e.g., Chat focused, URL reached).
*   **Heuristic Logic:** The system determines if the goal is reachable via a **Deep Link** (URL parameter) or a stable **Selector Chain**.
*   **Local Storage:** The workflow is serialized and pushed to `chrome.storage.local`.
    ```json
    {
      "voice_trigger": "call_ivann",
      "method": "DEEP_LINK",
      "payload": "https://domain.com/messages/t/target_id",
      "fallback_logic": "input[aria-label='Search']"
    }
    ```

---

## Phase 3: High-Speed Replay & Self-Healing
*Goal: Instant execution of saved macros with automatic error correction.*

### 3.1 Optimized Replay (Latency: <100ms)
*   **Action:** User triggers a known voice command.
*   **Process:** Extension performs a local lookup in `chrome.storage`. 
*   **Execution:** The system attempts an "Optimistic Navigation" using the saved Deep Link. Because the data is local, navigation begins **instantly** without waiting for a server response.

### 3.2 Automated Self-Healing
*   **Failure Detection:** If the link is broken (404) or the website structure has changed.
*   **Recovery:** The extension silently re-engages the **Vertex AI Agent**. The AI re-navigates the site from scratch, finds the new target, and **overwrites the stale local entry** with the updated path.

---

# 4. Ambient Instruction Guardian (The Safety Moat)

### 4.1 Cross-Device Instruction Monitoring
*   **Scenario:** The user receives verbal instructions from a phone call while near the laptop.
*   **Capture:** The laptop microphone captures ambient audio of the external speaker.
*   **Analysis:** The stream is piped via Cloud Run to **Gemini 2.5 Flash Live**. 
*   **Logic:** The AI "skims" the verbal instruction for malicious patterns.
    *   *Safe:* "Open Amazon and check my order." -> **Execute Macro.**
    *   *Malicious:* "Go to my bank and transfer money to this account." -> **BLOCK & INTERRUPT.**
*   **Response:** If malicious intent is identified, the extension overlays a persistent Red Alert UI across the browser, preventing any further DOM interaction.

---

# 5. Winning Differentiators (Hackathon Focus)
1.  **Native Audio Intelligence:** Direct Raw Audio streaming to Gemini 2.5 Flash for sub-second intent parsing.
2.  **Privacy-First Automation:** Client-side PII scrubbing and **Local-Only Storage** ensures user data never lives on a cloud database.
3.  **Self-Healing Resilience:** One-Shot Learning converts non-deterministic AI behavior into stable, repeatable local scripts that repair themselves upon failure.