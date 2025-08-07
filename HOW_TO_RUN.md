
# 📖 HOW TO RUN EcoSearch v2.0

---

## ✅ What is this?

EcoSearch is a **Retrieval-Augmented Generation (RAG)** prototype.  
It splits a text file into chunks, generates summaries and questions with GPT, then verifies if those chunks really answer your test questions — using GPT for containment checks.

---

## ⚙️ Requirements

- Python 3.9+
- An **OpenAI API key** (required for GPT calls)
- Dependencies from `requirements.txt`

---

## 🔑 1️⃣ Get your OpenAI API key

1. Go to [https://platform.openai.com/](https://platform.openai.com/)  
2. Log in to your account  
3. Navigate to **API Keys**  
4. Click **Create new secret key**  
5. Copy it and keep it safe — you won't see it again

---

## 🔑 2️⃣ Set your API key

You need to let EcoSearch know your API key.  
You can do it in **one** of these ways:

**▶ Option 1 — Environment variable**

**macOS/Linux**
```bash
export OPENAI_API_KEY="YOUR_API_KEY_HERE"
```

**Windows PowerShell**
```powershell
setx OPENAI_API_KEY "YOUR_API_KEY_HERE"
```

---

**▶ Option 2 — .env file (if using python-dotenv)**

Add a `.env` file in the same folder:
```env
OPENAI_API_KEY=YOUR_API_KEY_HERE
```

---

**▶ Option 3 — Hardcode** (not recommended)

In `eco_backend.py`:
```python
OPENAI_API_KEY = "YOUR_API_KEY_HERE"
```

---

## 🚀 3️⃣ Install dependencies

From your project folder:

```bash
pip install -r requirements.txt
```

---

## 🟢 4️⃣ Run EcoSearch

**Start the backend:**
```bash
uvicorn eco_backend:app --reload --port 8000
```

**Start the Streamlit frontend:**
```bash
streamlit run eco_web.py
```

Then open your browser at `http://localhost:8501` to use EcoSearch.

---

## ✅ 5️⃣ Try the full flow

1. Use **Generate** ➜ Upload `example.txt` ➜ Create `chunk_questions.json`
2. Use **Query** ➜ Ask a test question
3. Use **Evaluate** ➜ Upload `chunk_questions.json` + `test_set_ground_truth.json` ➜ See `Recall@1` and `Recall@3`
4. Check `containment_log.txt` for GPT containment evidence

---

## 🗂️ Files included

- `eco_backend.py` ➜ FastAPI backend
- `eco_web.py` ➜ Streamlit frontend
- `requirements.txt` ➜ Required Python packages
- `example.txt` ➜ Sample source text
- `test_set_ground_truth.json` ➜ Example test questions
- `autolabel.test_set.py` ➜ Script to align test set to chunks
- `containment_log.txt` ➜ GPT check log (created after Evaluate)

---

## 👨‍💻 Author

**Maurizio — Portfolio Retrieval Engineer**  
EcoSearch v2.0 — [https://www.linkedin.com/in/maurizio-scibilia-a3066592/](https://www.linkedin.com/in/maurizio-scibilia-a3066592/)

---

Happy testing! 🌱
