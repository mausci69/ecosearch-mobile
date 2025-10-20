📱 Device (Offline-capable)
- OCR: Tesseract / Expo-MLKit
- Chunking: local JS / Python wasm
- Summarisation + Q-generation: lightweight local LLM (e.g., Mistral 7B GGUF via llama.cpp)
- Local cache: AsyncStorage + SQLite
- Retrieval: cosine similarity on precomputed embeddings
- Fallback: queue generation requests for later sync

☁️ Server (Online / Sync)
- Full summarisation + question generation via GPT-4
- FAISS + CrossEncoder reranking
- Evaluation + recall metrics
- Sync endpoint for queued offline jobs

# EcoSearch Mobile — Offline RAG Plan

## Goals
- Enable summarisation and question generation offline on-device.
- Keep retrieval usable without network.
- Seamlessly sync when online.

## Responsibilities

### 📱 Device (Offline-capable)
- **OCR:** ML Kit / Tesseract (Expo), multi-page scan → PDF → text.
- **Chunking:** local JS (token/sentence based) or wasm (Python-in-wasm optional).
- **Embeddings:** local small model (gguf) or cached server embeddings when available.
- **Summarisation & Q-generation:** lightweight local LLM (e.g. Mistral-7B/Q4_K_M via llama.cpp or RN binding).
- **Storage:** AsyncStorage (prefs) + SQLite (corpora, chunks, embeddings, summaries, questions).
- **Retrieval:** cosine similarity over embeddings; optional mini-rerank (linear/logit).
- **Fallback queue:** if generation can’t run locally, queue jobs for later server sync.

### ☁️ Server (Online / Sync)
- **Generation (full):** GPT-4/Claude for high-quality summaries & questions.
- **Indexing:** FAISS + CrossEncoder reranking for web/desktop.
- **Evaluation:** Recall@1/3, oracle spans, sentence-index overlap.
- **Sync API:** upload offline queues; download enhanced summaries/embeddings.

## Data Model (SQLite)
- `documents(id, title, created_at, source, lang)`
- `chunks(id, document_id, idx, text, sentence_ids_json)`
- `embeddings(id, chunk_id, model, dim, vector_b64, created_at)`
- `summaries(id, chunk_id, model, text)`
- `questions(id, chunk_id, origin {chunk|summary|server}, text)`
- `queues(id, type {gen|sync}, payload_json, status, last_error)`

## Offline → Online Flow
1) Scan/Import → OCR → Text → Chunk.
2) If local LLM available → Summarise + Generate Qs → Embed → Retrieve (offline).
3) If not available → enqueue (`queues`) → allow basic retrieval on previous embeddings.
4) On reconnect → sync queued jobs → fetch server-quality artefacts → update local DB.

## UI Hooks
- **Badges:** “Offline mode”, “Queued for sync”.
- **Actions:** Retry generation, manual sync.
- **Settings:** Toggle local LLM, model quality (Q4/Q5), cache management.

## Testing (Days 4–5)
- Offline smoke tests (airplane mode): OCR → chunk → retrieve.
- Local LLM latency & memory on device (target <1.5 GB, <8s per summary).
- Queue & sync resilience: kill app mid-queue; verify replay.
- SQLite integrity and migration.

## Risks & Mitigations
- **Device limits:** quantised models, dynamic offloading, cap context length.
- **Battery/heat:** batch jobs when charging; throttle background work.
- **Quality variance:** server “upgrade” pass overwrites/augments local artefacts.

## Next
- Implement SQLite schema + DAOs.
- Wire local llama.cpp bridge (or placeholder stub with queue).
- Add UI state for offline badges and sync button.

