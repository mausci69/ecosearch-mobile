# 🌱 EcoSearch v2.1 — LLM-Free & Offline-Capable Semantic Retrieval (+ Mobile OCR)

**EcoSearch** is a lean, primarily LLM-free semantic retrieval system with optional **mobile OCR capture**  
and **offline summarisation + question generation** capabilities.

- 🔍 Dense retrieval on **FAISS-indexed** text chunks  
- 🧭 **Cross-Encoder** reranking for sharper top results  
- 💾 **Offline SQLite + AsyncStorage cache** for local corpora  
- 🧠 Optional **local LLM (Mistral 7B GGUF / llama.cpp)** for summarisation + Q-generation  
- 📷 Multi-page **mobile scan-to-PDF** ingestion flow  
- 🧪 Tested OCR endpoint (`return_pdf=true` for PDF assembly)

> GPT services are optional: EcoSearch works end-to-end offline,  
> syncing later to enrich or replace locally generated data.

---

## 🚀 Workflow

### 1) Prepare (LLM-free or Local)
- Upload or scan a document (PDF → text via OCR).  
- Split into fixed chunks (default = 3 sentences).  
- Create embeddings (SentenceTransformer) → build/update **FAISS index**.  
- If available, use local LLM for summaries + questions; else queue for later sync.  
- Persist corpus metadata to SQLite + JSON.

### 2) Query
1. Embed question  
2. Retrieve top-k via **FAISS**  
3. Rerank with **Cross-Encoder**  
4. Display **Top-1** chunk (+ optional alternative)  
5. Show **agentic confidence** banner suggesting next action

### 3) (Optional) OCR → PDF Ingestion
- Capture multiple pages on mobile.  
- Backend endpoint assembles a single PDF or returns per-page JSON text.  
- Works offline if cached; syncs when online.

---

## 🧩 Backend Endpoints

- `POST /prepare_corpus` — ingest text, split, embed, index  
- `POST /query` — retrieval + rerank  
- `POST /clear_corpus` — clear state  
- `POST /ocr_extract` — OCR / PDF assembly  
  - Single page: `file=@p1.jpg` `?lang=ita`  
  - Multi-page PDF: `files[]=@p1.jpg` `files[]=@p2.jpg` `?return_pdf=true`  

---

## 📱 Mobile (Expo)

- **Offline-first workflow**  
  - OCR → text → chunk → optional local summarisation/Q-generation  
  - Store to SQLite and retrieve instantly  
  - Queue for server upgrade when online  
- **Files**
  - `src/features/ocr/MultiPageScan.tsx` — multi-page UI  
  - `src/lib/db/` — SQLite layer (planned)  
  - `src/lib/llm/` — local LLM bridge  
  - `src/utils/savePdf.ts` — blob → file → share  

---

## ⚙️ Dependencies

**Python**
- `fastapi`, `uvicorn`, `sentence-transformers`, `faiss-cpu`  
- `scikit-learn`, `numpy`, `pillow`, `pytesseract`

**Mobile**
- `expo-image-picker`, `expo-filesystem`, `expo-sqlite`, `react-native-llama` (placeholder)  
- Local quantised models (`*.gguf`) for offline LLM

---

## 🧪 Tests

- `pytest tests/test_ocr_extract.py` — OCR JSON + PDF  
- Future: offline queue & sync integrity, local LLM smoke tests

---

## 🏗️ Architecture Overview
See [`docs/architecture/mobile-offline-rag-plan.md`](docs/architecture/mobile-offline-rag-plan.md)

---

## 👨‍💻 Author

**Maurizio Scibilia** — Retrieval Engineer & Creator of EcoSearch

---

## ⚖️ Licence & Ownership

EcoSearch v2.1 is a personal, independent project.  
All rights belong to the author.  
Reuse or adaptation requires attribution.

**© 2025 Maurizio Scibilia — All rights reserved.**
