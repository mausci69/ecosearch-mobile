
# 🌱 EcoSearch v2.0 — Semantic Retrieval + GPT Containment

**EcoSearch** is a **Retrieval-Augmented Generation (RAG)** prototype combining:  
- 🔍 Semantic retrieval on FAISS-indexed text chunks  
- ✂️ Sliding window chunking with optional merging  
- 🤖 GPT-generated questions for each chunk or summary  
- ✅ Evaluation of **Recall@1/3** based on a *dynamic GPT containment check*

---

## 🚀 Workflow

### 1️⃣ Generate
- Upload a `.txt` file.
- Split it into chunks of 3 sentences.
- GPT summarises each chunk.
- GPT generates **one question** per chunk or summary.
- Saves `chunk_questions.json`:

```json
{
  "chunk": "...",
  "summary": "...",
  "question": "...",
  "embedding": [...]
}
```

---

### 2️⃣ Query
- Load your `chunk_questions.json`.
- Enter a question.
- EcoSearch retrieves:
  - The most similar questions via cosine similarity.
  - The linked chunk.
- (Optional) GPT can answer using only the selected chunk ➜ real containment verification.

---

### 3️⃣ Evaluate
- Load a `test_set.json` and your `chunk_questions.json`.
- For each test question:
  - Retrieve `top1` and `top3` chunks.
  - GPT verifies whether the chunk actually contains enough information.
- Outputs:
  - `Recall@1` = percentage of questions covered by the first match.
  - `Recall@3` = percentage covered within the top three.

---

## ✅ Why containment is different
No static `correct_chunk_indices`.  
A chunk must **genuinely contain** the answer — GPT checks this dynamically for each test question.

---

## 📂 Example structure
- `eco_backend.py`
- `eco_web.py`
- `requirements.txt`
- `test_set_ground_truth.json`
- `containment_log.txt` (optional, for auditing GPT decisions)

---

## ⚙️ How to run

**1️⃣ Start the backend:**
```bash
uvicorn eco_backend:app --reload
```

**2️⃣ Start the frontend:**
```bash
streamlit run eco_web.py
```

---

## 👨‍💻 Author
Maurizio — Portfolio Retrieval Engineer | EcoSearch v2.0

---

## ⚖️ Licence & Ownership Disclaimer

**EcoSearch v2.0** was entirely developed by **Maurizio Scibilia** in a personal capacity.

- No company assets, confidential data, or internal code were used.
- All development was done on personal hardware, using privately funded services and tools.
- Any working time overlaps occurred only during periods of non-allocation, without impact on any company deliverables.
- This prototype is provided for personal portfolio and demonstration purposes only.

The intellectual property rights for the design, code, and workflow remain with the author.

If you wish to reuse, adapt, or extend EcoSearch, please credit the author and refer to the included licence terms.

---

**© 2024 Maurizio Scibilia — All rights reserved.**

