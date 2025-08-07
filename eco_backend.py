from fastapi import FastAPI, APIRouter, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, CrossEncoder
from openai import OpenAI, RateLimitError
import openai
from sklearn.metrics.pairwise import cosine_similarity
import faiss
import numpy as np
import nltk
from nltk.tokenize import sent_tokenize
import json
import os
import datetime
import time
from difflib import SequenceMatcher, get_close_matches
import re
import io

nltk.download('punkt')

reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
nltk.download("punkt")

# === Setup ===
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY)
embedder = SentenceTransformer("all-mpnet-base-v2")
app = FastAPI()

# === In-memory ===
chunks = []
summaries = []
index = None
corpus_data = []
latest_filename = ""

full_text = ""
indexed_sentences = []


# === Config ===
CHUNK_SIZE = 3


# === Pydantic ===
class CorpusRequest(BaseModel):
    text: str

class QueryRequest(BaseModel):
    question: str

class AnswerRequest(BaseModel):
    question: str
    chunk: str

class EvaluateRequest(BaseModel):
    test_set: list
    corpus: list
    corpus_file_path: str
    smart_evaluation: bool = False

# === Helpers ===

def to_python_types(obj):
    """Recursively convert all NumPy types in obj to native Python types for JSON serialization."""
    if isinstance(obj, dict):
        return {k: to_python_types(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [to_python_types(x) for x in obj]
    elif isinstance(obj, np.generic):
        return obj.item()
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    else:
        return obj

def chunk_text(text):
    sentences = nltk.sent_tokenize(text)
    return [
        " ".join(sentences[i : i + CHUNK_SIZE])
        for i in range(0, len(sentences) - CHUNK_SIZE + 1, 1)
    ]

def generate_summary(chunk):
    prompt = (
        "Summarize this chunk in no more than 20 words. "
        "Keep only the core idea. No examples. No extra details.\n\n"
        f"{chunk}"
    )
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a precise summarizer."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=150,
    )
    return response.choices[0].message.content.strip()

def generate_question(summary, existing_questions):
    prompt = (
        "Generate exactly one short direct question for the summary. "
        "Use no more than 10 words. No extra info.\n\n"
        f"{summary}"
    )
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a precise question generator."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=150,
    )
    question = response.choices[0].message.content.strip()

    # Text dedup
    if question in existing_questions:
        return None, None

    embedding = embedder.encode(question)
    return question, embedding

def merge_chunks(data):
    merged = []
    i = 0
    while i < len(data):
        chunk_i, summary_i, question_i, emb_i = data[i]
        if i + 1 < len(data):
            chunk_j, summary_j, question_j, emb_j = data[i + 1]

            # manual cosine similarity
            sim = np.dot(emb_i, emb_j) / (np.linalg.norm(emb_i) * np.linalg.norm(emb_j))

            if sim >= 0.95:
                chunk_merged = chunk_i + " " + chunk_j
                summary_merged = generate_summary(chunk_merged)
                merged.append((chunk_merged, summary_merged, question_i, emb_i))
                i += 2
                continue

        merged.append((chunk_i, summary_i, question_i, emb_i))
        i += 1
    return merged

def generate_oracle_span(full_text: str, question: str) -> str:
    """
    Ask the LLM to select the best 3 consecutive sentences
    from full_text that best answer the given question.
    """
    prompt = f"""
    You are an assistant helping to extract the best possible passage.
    Given the following question: "{question}"
    and the text below, select exactly 3 consecutive sentences 
    that best answer the question.

    Text:
    {full_text}

    Return ONLY the 3 selected sentences.
    """

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": prompt}
        ]
    )

    oracle_span = response.choices[0].message.content.strip()
    return oracle_span

def calculate_overlap(answer: str, retrieved_text: str) -> float:
    """
    Compute simple word overlap ratio between LLM answer and retrieved text.
    """
    def tokenize(text):
        return set(re.findall(r'\w+', text.lower()))

    answer_tokens = tokenize(answer)
    retrieved_tokens = tokenize(retrieved_text)

    if not answer_tokens:
        return 0.0

    overlap = answer_tokens.intersection(retrieved_tokens)
    return len(overlap) / len(answer_tokens)

def safe_chat_completion_call(client, **kwargs):
    while True:
        try:
            return client.chat.completions.create(**kwargs)
        except RateLimitError:
            print("⚠️ Rate limit reached. Waiting 60 seconds before retrying...")
            time.sleep(60)

def normalize(text):
    text = text.lower()
    text = re.sub(r'\[.*?\]', '', text)  # remove bracketed notes
    text = re.sub(r'[•–—\-]', ' ', text)  # normalize bullets and dashes
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def fuzzy_match(oracle_sent, chunk_sent, threshold=0.9):
    return SequenceMatcher(None, normalize(oracle_sent), normalize(chunk_sent)).ratio() >= threshold

def map_oracle_span_to_sentence_ids(oracle_span, chunk_text, chunk_sentence_ids):
    chunk_sentences = sent_tokenize(chunk_text)
    oracle_sentences = sent_tokenize(oracle_span)

    matched_ids = []

    for oracle_s in oracle_sentences:
        for i, chunk_s in enumerate(chunk_sentences):
            if fuzzy_match(oracle_s, chunk_s):
                matched_ids.append(chunk_sentence_ids[i])
                break

    return matched_ids

# === Endpoints ===

@app.get("/download_corpus_json")
def download_corpus_json():
    # Export the latest in-memory corpus_data as JSON, on-the-fly
    json_bytes = io.BytesIO(json.dumps(corpus_data, ensure_ascii=False, indent=2).encode("utf-8"))
    return StreamingResponse(json_bytes, media_type="application/json", headers={
        "Content-Disposition": "attachment; filename=corpus_data.json"
    })

@app.post("/prepare_corpus")
def prepare_corpus(data: CorpusRequest):
    global chunks, summaries, index, corpus_data, latest_filename

    # Step 1: Split the full text into indexed sentences
    sentences = sent_tokenize(data.text)
    global full_text, indexed_sentences
    full_text = data.text
    indexed_sentences = list(enumerate(sentences))

    # Step 2: Create initial chunks with sentence indices
    chunk_size = 3
    overlap = 2
    chunks = []
    i = 0
    while i < len(indexed_sentences):
        current_chunk = indexed_sentences[i:i + chunk_size]
        if not current_chunk:
            break
        sentence_ids = [idx for idx, _ in current_chunk]
        chunk_text = " ".join(s for _, s in current_chunk)
        chunks.append((chunk_text, sentence_ids))
        i += chunk_size - overlap

    print(f"Chunks created: {len(chunks)}")

    # Step 3: Generate summaries
    summaries = [generate_summary(c[0]) for c in chunks]
    print(f"Summaries generated: {len(summaries)}")

    existing_questions = []
    temp = []
    skipped = 0

    # Step 4: Generate guiding questions from summaries
    for (chunk_text, sentence_ids), s in zip(chunks, summaries):
        q, emb = generate_question(s, existing_questions)
        if q and emb is not None:
            existing_questions.append(q)
            temp.append({
                "chunk": chunk_text,
                "summary": s,
                "question": q,
                "embedding": emb,
                "sentence_ids": sentence_ids
            })
            print(f"[Q] {q}")
        else:
            skipped += 1
            print(f"[Q SKIPPED] for chunk: {chunk_text}")

    print(f"Questions skipped: {skipped}")

    # Step 5: Merge if needed (preserving sentence_ids)
    merged = []
    for t in temp:
        merged.append((
            t["chunk"],
            t["summary"],
            t["question"],
            t["chunk"],  # full_text (can be same as chunk unless custom)
            t["sentence_ids"]
        ))

    print(f"Chunks after merge: {len(merged)}")

    # Step 6: Build corpus data with sentence_ids included
    corpus_data = []
    for c, s, q, full_text, sentence_ids in merged:
        c = str(c) if not isinstance(c, str) else c
        s = str(s) if not isinstance(s, str) else s
        q = str(q) if not isinstance(q, str) else q
        full_text = str(full_text) if not isinstance(full_text, str) else full_text
        emb = embedder.encode([q], normalize_embeddings=True)[0].astype(np.float32)
        corpus_data.append({
            "chunk": c,
            "summary": s,
            "question": q,
            "embedding": emb.tolist(),
            "full_text": full_text,
            "sentence_ids": sentence_ids
        })

    # Step 7: Build FAISS index
    embs = np.array([d["embedding"] for d in corpus_data], dtype=np.float32)
    index = faiss.IndexFlatL2(embs.shape[1])
    index.add(embs)

    # Step 7b: Fix NumPy types
    for item in corpus_data:
        if "sentence_ids" in item:
            item["sentence_ids"] = [int(x) for x in item["sentence_ids"]]
        if "reranked_sentence_ids" in item:
            item["reranked_sentence_ids"] = [int(x) for x in item["reranked_sentence_ids"]]
        if "reranked_top_chunk_idx" in item:
            item["reranked_top_chunk_idx"] = int(item["reranked_top_chunk_idx"])
        if "retrieved_sentence_ids" in item:
            item["retrieved_sentence_ids"] = [int(x) for x in item["retrieved_sentence_ids"]]
        if "reranked_top_chunk_score" in item:
            item["reranked_top_chunk_score"] = float(item["reranked_top_chunk_score"])
    corpus_data = to_python_types(corpus_data)

    # Step 8: Add top reranked guiding question to each question
    for item in corpus_data:
        q = item["question"]
        q_embedding = embedder.encode([q], normalize_embeddings=True)[0].astype(np.float32)

        # Get top-5 similar guiding questions
        D, I = index.search(np.array([q_embedding]), k=5)
        candidates = [(corpus_data[i]["question"], i) for i in I[0]]

        # Rerank with CrossEncoder (question-to-question)
        rerank_inputs = [(q, guiding_question) for guiding_question, _ in candidates]
        rerank_scores = reranker.predict(rerank_inputs)
        best_idx = candidates[np.argmax(rerank_scores)][1]
        best = corpus_data[best_idx]

        # Add retrieved top-1 chunk and sentence_ids
        item["reranked_top_chunk"] = best["chunk"]
        item["reranked_top_chunk_idx"] = best_idx
        item["reranked_sentence_ids"] = best["sentence_ids"]
        item["reranked_summary"] = best.get("summary", "")

    corpus_data = to_python_types(corpus_data)
    print("Corpus prepared in memory")
    return {"status": "Corpus prepared", "chunks": len(corpus_data)}

@app.get("/get_corpus_json")
def get_corpus_json():
    return FileResponse(latest_filename, media_type="application/json")

@app.post("/load_corpus_file")
def load_corpus_file(file_path: str):
    """
    Load a precomputed chunk_questions JSON file and initialise the FAISS index.
    """
    global corpus_data, index, latest_filename

    if not os.path.isfile(file_path):
        return {"error": f"File not found: {file_path}"}

    with open(file_path, "r", encoding="utf-8") as f:
        corpus_data = json.load(f)

    # Extract embeddings and build the FAISS index
    embeddings = np.array([q["embedding"] for q in corpus_data], dtype=np.float32)
    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)

    latest_filename = file_path

    print(f"✅ Corpus loaded: {len(corpus_data)} entries. Index built with {index.ntotal} vectors.")
    return {"status": "Corpus loaded", "chunks": len(corpus_data), "file": file_path}

@app.post("/query")
def query(data: QueryRequest):
    if index is None or not corpus_data:
        return {"error": "No corpus loaded."}

    # Embed the user query
    q_embedding = embedder.encode([data.question], normalize_embeddings=True)[0].astype(np.float32)

    # Step 1: FAISS top-5 (against guiding question embeddings)
    D, I = index.search(np.array([q_embedding]), k=5)
    candidates = [(corpus_data[i]["question"], i) for i in I[0]]  # use guiding question, not chunk

    # Step 2: CrossEncoder rerank (question-to-guiding-question)
    rerank_inputs = [(data.question, guiding_question) for guiding_question, _ in candidates]
    rerank_scores = reranker.predict(rerank_inputs)
    best_idx = int(np.argmax(rerank_scores))
    _, chunk_index = candidates[best_idx]
    best_score = float(rerank_scores[best_idx])

    # Step 3: Return the chunk and details
    result = corpus_data[chunk_index]
    return {
        "question": data.question,
        "guiding_question": result["question"],
        "chunk": result["chunk"],
        "summary": result.get("summary", ""),
        "score": best_score,  # CrossEncoder score (question-to-guiding-question)
        "cosine_score": float(1 - float(D[0][best_idx])),  # similarity score
        "sentence_ids": [int(x) for x in result.get("sentence_ids", [])],
        "chunk_index": int(chunk_index)
    }

@app.post("/fallback")
def fallback(data: QueryRequest):
    if not corpus_data:
        return {"error": "Corpus not loaded.", "results": []}

    # Concatenate all chunks into a single text
    full_text = " ".join([item["chunk"] for item in corpus_data])
    sentences = full_text.split(". ")
    sentence_embeddings = embedder.encode(sentences, normalize_embeddings=True)

    q_embedding = embedder.encode([data.question], normalize_embeddings=True)[0].astype(np.float32)
    scores = np.dot(sentence_embeddings, q_embedding)

    # Select best 3 consecutive sentences
    best_idx = int(np.argmax(scores))
    start = max(0, best_idx - 1)
    end = min(len(sentences), best_idx + 2)
    best_chunk = ". ".join(sentences[start:end])

    return {
        "chunk": best_chunk,  # ✅ unified key name
        "score": float(max(scores)),
        "start_idx": start
    }

@app.post("/llm_answer_from_chunk")
def llm_answer_from_chunk(data: AnswerRequest):
    if not data.chunk or not data.question:
        return {"error": "Both chunk and question are required."}

    print("\n--- LLM ANSWER FROM CHUNK DEBUG ---")
    print("QUESTION:", repr(data.question))
    print("CHUNK:", repr(data.chunk[:200]))
    
    prompt = (
        f"The following passage comes from a document the user uploaded:\n\n"
        f"{data.chunk}\n\n"
        f"Answer the question:\n{data.question}\n\n"
        "Use only the passage above and do not rely on external knowledge."
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a precise answerer who only uses the given passage."},
            {"role": "user", "content": prompt}
        ],
        temperature=0,
    )

    answer = response.choices[0].message.content.strip()
    print("RAW ANSWER:", repr(answer))
    return {"answer": answer}

@app.post("/llm_fallback_answer")
def llm_fallback_answer(data: QueryRequest):
    import nltk
    from nltk.tokenize import sent_tokenize

    nltk.download('punkt', quiet=True)

    if index is None or not corpus_data:
        return {"error": "No corpus loaded."}
    if not data.question:
        return {"error": "Question is required."}

    # Embed the question
    q_embedding = embedder.encode([data.question], normalize_embeddings=True)[0]

    # Get all sentences from all chunks
    all_sentences = []
    for entry in corpus_data:
        chunk_sentences = sent_tokenize(entry["chunk"])
        all_sentences.extend(chunk_sentences)

    if len(all_sentences) < 3:
        return {"error": "Not enough sentences in the corpus for fallback."}

    # Embed all sentences
    sentence_embeddings = embedder.encode(all_sentences, normalize_embeddings=True)

    # Find best 3 consecutive sentences
    max_score = -1
    best_start = 0
    for i in range(len(all_sentences) - 2):
        span = sentence_embeddings[i:i+3]
        span_avg = sum(span) / 3
        score = cosine_similarity([q_embedding], [span_avg])[0][0]
        if score > max_score:
            max_score = score
            best_start = i

    fallback_chunk = " ".join(all_sentences[best_start:best_start+3])
    print(f"🔍 Selected fallback span (score={max_score:.3f}):\n{fallback_chunk}")

    # Ask the LLM
    prompt = (
        f"The following excerpt was extracted from the corpus as the most relevant to answer the user's question.\n\n"
        f"{fallback_chunk}\n\n"
        f"Please answer this question using only the information above:\n{data.question}"
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a precise answerer who uses only the provided fallback context."},
            {"role": "user", "content": prompt}
        ],
        temperature=0,
    )

    return {
        "answer": response.choices[0].message.content.strip(),
        "fallback_chunk": fallback_chunk,
        "similarity": float(max_score)
    }

@app.post("/llm_answer_from_fallback_chunk")
def llm_answer_from_fallback_chunk(data: AnswerRequest):
    if not data.chunk or not data.question:
        return {"error": "Both chunk and question are required."}

    prompt = (
        f"The following passage was selected from the full text as most relevant:\n\n"
        f"{data.chunk}\n\n"
        f"Answer the question:\n{data.question}"
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a precise answerer who uses only the provided context."},
            {"role": "user", "content": prompt}
        ],
        temperature=0,
    )

    return {"answer": response.choices[0].message.content.strip()}

@app.post("/evaluate")
def evaluate(data: EvaluateRequest):
    import difflib  # Ensure this import is present at the top of your file
    openai.api_key = os.getenv("OPENAI_API_KEY")
    llm_model = "gpt-4o"

    test_set = data.test_set
    corpus = data.corpus
    with open(data.corpus_file_path, "r", encoding="utf-8") as f:
        full_text = f.read()
    sentences = nltk.sent_tokenize(full_text)
    corpus_questions = [c["question"] for c in corpus]

    # Fuzzy match, always return closest
    def find_best_match(test_question, corpus_questions):
        tq = test_question.strip().lower()
        cqs = [q.strip().lower() for q in corpus_questions]
        matches = difflib.get_close_matches(tq, cqs, n=1, cutoff=0.0)
        if matches:
            idx = cqs.index(matches[0])
            return idx
        return None

    results = []
    n_full = 0
    n_partial = 0
    n_none = 0

    for entry in test_set:
        question = entry["question"]

        # LLM oracle: shortest consecutive up to 3
        prompt = (
            "Given the following document split into sentences:\n\n"
            + "\n".join(f"{j+1}. {sent}" for j, sent in enumerate(sentences))
            + f"\n\nFor the question below, extract the shortest possible consecutive span (up to 3 sentences) "
            "that completely answers the question. Return ONLY the sentence numbers (starting from 1), separated by commas, "
            "and then the extracted text on the next line.\n\n"
            f"Question: {question}\n"
            "Answer:"
        )
        print(f"Calling LLM for question: {repr(question)}")
        try:
            response = client.chat.completions.create(
                model=llm_model,
                messages=[
                    {"role": "system", "content": "You are a helpful assistant for extracting answer spans."},
                    {"role": "user", "content": prompt},
                ],
                max_tokens=512,
                temperature=0,
            )
            print(f"LLM call completed for question: {repr(question)}")
            answer = response.choices[0].message.content.strip()
            lines = answer.splitlines()
            first_line = lines[0] if lines else ""
            sentence_nums = [int(s.strip())-1 for s in first_line.replace('.', '').split(',') if s.strip().isdigit()]
            oracle_span = " ".join(sentences[idx] for idx in sentence_nums) if sentence_nums else ""
        except Exception as e:
            print(f"LLM ERROR for question: {repr(question)} — {e}")
            sentence_nums = []
            oracle_span = ""
        # If oracle is empty, always NONE
        if not sentence_nums:
            results.append({
                "question": question,
                "oracle_sentence_ids": [],
                "oracle_span": "",
                "ecosearch_chunk_indices": [],
                "ecosearch_chunk_text": "",
                "overlap": "NONE"
            })
            n_none += 1
            continue

        idx = find_best_match(question, corpus_questions)
        ecosearch_entry = corpus[idx] if idx is not None else None
        chunk_indices = ecosearch_entry.get("reranked_sentence_ids", []) if ecosearch_entry else []
        chunk_text = ecosearch_entry.get("reranked_top_chunk", "") if ecosearch_entry else ""

        set_oracle = set(sentence_nums)
        set_chunk = set(chunk_indices)
        if set_oracle and set_oracle <= set_chunk:
            overlap = "FULL"
            n_full += 1
        elif set_oracle and set_oracle & set_chunk:
            overlap = "PARTIAL"
            n_partial += 1
        else:
            overlap = "NONE"
            n_none += 1

        # === DEBUG PRINT BLOCK ===
        if len(results) < 5:  # Only print for first 5 test questions
            print("\n--- Debug for Test Question ---")
            print("Test question:", repr(question))
            print("Matched corpus question:", repr(ecosearch_entry['question'] if ecosearch_entry else "None"))
            print("Reranked chunk indices:", chunk_indices)
            print("Reranked chunk text:", repr(chunk_text[:200]))
            print("LLM oracle indices:", sentence_nums)
            print("LLM oracle span:", repr(oracle_span))
            print("Overlap type:", overlap)
            print("Oracle sentences:")
            for idx in sentence_nums:
                if 0 <= idx < len(sentences):
                    print(f"  {idx}: {repr(sentences[idx])}")
            print("Chunk sentences:")
            for idx in chunk_indices:
                if 0 <= idx < len(sentences):
                    print(f"  {idx}: {repr(sentences[idx])}")

        results.append({
            "question": question,
            "oracle_sentence_ids": sentence_nums,
            "oracle_span": oracle_span,
            "ecosearch_chunk_indices": chunk_indices,
            "ecosearch_chunk_text": chunk_text,
            "overlap": overlap
        })

    return {
        "n_questions": len(test_set),
        "full": n_full,
        "partial": n_partial,
        "none": n_none,
        "results": results,
    }

# === Run ===
# uvicorn eco_backend:app --reload --port 8000
