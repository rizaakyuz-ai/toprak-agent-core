# Toprak — Autonomous Multi-Agent Task Orchestrator & Dual-Driver Engine

Toprak is an autonomous multi-agent task execution system built in TypeScript/Node.js. It decouples probabilistic reasoning agents (trend researchers, content drafters, schema validators) from deterministic pipelines (audio extraction, transcription, headless media synthesis, and delivery).

---

## Architectural Highlights

### 1. Separation of Probabilistic Reasoning from Deterministic Execution
Large Language Model agents are non-deterministic by nature. Toprak enforces a strict architectural boundary:
* **Reasoning Phase (Probabilistic):**
  * `TrendAgent`: Discovers topical opportunities and formats structured conceptual briefs.
  * `PromptArchitect & CopywriterAgent`: Drafts execution scripts adhering to brand voice rules and platform constraints.
  * `ValidatorAgent`: Evaluates semantic quality, structural safety, and adherence to constraints before any downstream side-effect execution.
* **Execution Phase (Deterministic):**
  * All media assembly, FFmpeg subtitle burning, and external API calls operate strictly on **immutable, schema-validated JSON payloads**.
  * A hard validation threshold ($\ge 80/100$) gates pipeline progression, preventing resource consumption on low-quality model outputs.

### 2. Dual-Driver Abstraction Layer
To enable rapid local development without requiring cloud infrastructure:
* **Local Mode:** Uses embedded SQLite / PGLite and in-memory disk queues. Zero external service dependencies.
* **Production Mode:** Switches seamlessly to PostgreSQL 16, BullMQ with Redis, and S3/R2 storage with zero business logic modifications.

### 3. Resilient State Machine & Asynchronous Queues
* Built on **BullMQ** and **Redis** for distributed task scheduling, rate-limiting, and automatic retry backoff.
* Fully serializable state representations ensure that interrupted workflows resume without data corruption or redundant model calls.

---

## Repository Structure

```text
├── agents/             # Probabilistic LLM agents (Trend, Copywriter, Validator, Prompt Architect)
├── core/               # Orchestration engine, AI router, memory, and config loaders
├── pipelines/          # Deterministic pipelines:
│   ├── ingestion/      # Audio extraction and Whisper transcription
│   ├── media/          # Subtitles, TTS engine, and FFmpeg assembly
│   └── handoff/        # Package exporter and external webhook injectors
├── config/             # Scenario and brand identity schemas
└── MIMARI_VE_TEKNIK_TASARIM.md  # Extended architecture documentation
```
