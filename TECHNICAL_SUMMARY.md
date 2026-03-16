# NIBO: Neural-Interface Browser Orchestrator

## Technical Infrastructure
**NIBO** is a distributed browser orchestration and security runtime engineered to optimize the **Latency-Security Gap** in LLM-driven automation. By correlating out-of-band audio telemetry with live DOM state, NIBO provides a **Safe-Traversal Autopilot** that intercepts malicious intent before it manifests as local browser actions.

## Core Features
### 1. One-Shot Heuristic Engine (Automation)
NIBO serializes non-deterministic model tool-calls into stable, structured navigation primitives.
*   **Zero-Inference Replay**: Completed workflows are stored in `chrome.storage.local` as macros, moving the execution logic to the edge to eliminate repeat inference latency and token egress.
*   **Self-Healing Resilience**: If a website UI changes, the system detects navigation failure and triggers an automated re-scan to update the local selector chain.

### 2. Ambient Instruction Guardian (Security)
A passive monitoring pipeline that ingests raw PCM audio and visual snapshots via **Gemini 2.5 Flash Multimodal Live API**.
*   **Weighted Risk Scoring**: Real-time intent analysis derives a risk score based on verbal urgency coefficients and active DOM context.
*   **Preemptive Mitigation**: Detections above a 0.7 threshold trigger an out-of-band audio barge-in and a browser-wide DOM-blocking UI overlay.

## System Architecture
*   **Inference**: Vertex AI (Gemini 2.5 Flash Native Audio) via GCP Cloud Run.
*   **Backend**: Python / FastAPI WebSocket bridge for high-frequency binary ingestion.
*   **Client**: Chrome Extension (React/Vite) utilizing `offscreen.html` for continuous PCM capture.
*   **Observability**: Integrated logic for tracking **Threat Blast Radius** and **Pre-filter Efficiency**.

## Engineering Challenges Overcome
*   **WebSocket Jitter**: Optimizing the FastAPI event loop to handle concurrent 16kHz audio streams and multipart image payloads.
*   **PII Sanitization**: Implementing a local Regex Redaction Pass to scrub sensitive metadata (CCN/SSN) before cloud egress.
*   **DOM Noise Reduction**: Developing a custom distillation engine that strips framework noise (React/Vue classes) to serialize the page into semantic ARIA landmarks.

## Roadmap
*   **Adaptive Safety Thresholds**: Dynamic risk adjustment based on live SLO health.
*   **Autonomous Honey-Pots**: Generating synthetic session data when social engineering is detected.
*   **Cross-Process Monitoring**: Extending the ambient sentinel to system-level events outside the browser.
