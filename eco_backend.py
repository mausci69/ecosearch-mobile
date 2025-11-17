from fastapi import FastAPI, APIRouter, UploadFile, File, Query, HTTPException, Body
from fastapi import status
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional
import img2pdf
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
from PIL import Image, ImageOps
import pytesseract

# Ensure punkt is available
nltk.download("punkt", quiet=True)

# Models
reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
embedder = SentenceTransformer("all-mpnet-base-v2")

# === Setup ===
ENABLE_LLM = os.getenv("ENABLE_LLM", "false").lower() in ("1", "true", "yes", "on")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY) if (ENABLE_LLM and OPENAI_API_KEY) else None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # later we can restrict to Expo/localhost origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def llm_available() -> bool:
    return client is not None


# === In-memory state ===
chunks = []
summaries = []
index = None
corpus_data = []
latest_filename = ""
full_text = ""
indexed_sentences = []

# === Config ===
CHUNK_SIZE = 3
CHUNK_OVERLAP = 2

# OCR config
# OCR_LANG is the default; current_ocr_lang traccia l’ultima lingua OCR effettivamente usata.
OCR_LANG = os.getenv("OCR_LANG", "eng")  # es. "eng", "ita", "eng+ita"
current_ocr_lang = OCR_LANG

print(f"✅ OCR ready — default language(s): {OCR_LANG}")


# === Pydantic models ===
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
    if isinstance(obj, dict):
        return {k: to_python_types(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_python_types(x) for x in obj]
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    return obj

def chunk_text(text):
    sentences = nltk.sent_tokenize(text)
    return [
        " ".join(sentences[i : i + CHUNK_SIZE])
        for i in range(0, len(sentences) - CHUNK_SIZE + 1, 1)
    ]

def generate_summary(chunk):
    if not llm_available():
        first_sent = sent_tokenize(chunk)[0] if chunk else ""
        words = first_sent.split()
        return " ".join(words[:20]).strip()

    prompt = (
        "Summarize this chunk in no more than 20 words. "
        "Keep only the core idea. No examples. No extra details.\n\n"
        f"{chunk}"
    )
    response = safe_chat_completion_call(
        client,
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
    if not llm_available():
        base = " ".join(summary.split()[:8]).strip()
        if not base:
            base = "main point"
        if not re.match(r"^(who|what|when|where|why|how)\b", base, re.IGNORECASE):
            base = f"What is {base}"
        base_words = base.split()[:10]
        question = " ".join(base_words).rstrip("?") + "?"
        if question in existing_questions:
            return None, None
        embedding = embedder.encode(question)
        return question, embedding

    prompt = (
        "Generate exactly one short direct question for the summary. "
        "Use no more than 10 words. No extra info.\n\n"
        f"{summary}"
    )
    response = safe_chat_completion_call(
        client,
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a precise question generator."},
            {"role": "user", "content": prompt},
        ],
        temperature=0.0,
        max_tokens=150,
    )
    question = response.choices[0].message.content.strip()
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

def generate_oracle_span(full_text_str: str, question: str) -> str:
    prompt = (
        f'You are an assistant helping to extract the best possible passage.\n'
        f'Given the following question: "{question}"\n'
        f'and the text below, select exactly 3 consecutive sentences that best answer the question.\n\n'
        f"Text:\n{full_text_str}\n\n"
        f"Return ONLY the 3 selected sentences."
    )

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": prompt},
        ],
    )
    oracle_span = response.choices[0].message.content.strip()
    return oracle_span

def calculate_overlap(answer: str, retrieved_text: str) -> float:
    def tokenize(text):
        return set(re.findall(r"\w+", text.lower()))

    answer_tokens = tokenize(answer)
    retrieved_tokens = tokenize(retrieved_text)
    if not answer_tokens:
        return 0.0
    overlap = answer_tokens.intersection(retrieved_tokens)
    return len(overlap) / len(answer_tokens)

def safe_chat_completion_call(client_obj, **kwargs):
    while True:
        try:
            return client_obj.chat.completions.create(**kwargs)
        except RateLimitError:
            print("Rate limit reached. Waiting 60 seconds before retrying.")
            time.sleep(60)

def normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"\[.*?\]", "", text)
    text = re.sub(r"[•–—\-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def fuzzy_match(oracle_sent: str, chunk_sent: str, threshold: float = 0.9) -> bool:
    return (
        SequenceMatcher(None, normalize(oracle_sent), normalize(chunk_sent)).ratio()
        >= threshold
    )

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

# === OCR endpoints ===
@app.post("/ocr_extract_pages")
async def ocr_extract_pages(
    files: List[UploadFile] = File(...),
    lang: str | None = Query(None),
    return_pdf: bool = Query(False),
):
    """
    Multi-page OCR:
    - Accepts multiple image files.
    - If return_pdf=true, returns combined PDF.
    - Otherwise returns JSON with combined text and per-page texts.
    Tracks current_ocr_lang from the effective lang used.
    """
    global current_ocr_lang

    if not files:
        return {"error": "No files provided."}

    used_lang = (lang or OCR_LANG).strip().lower()
    if used_lang == "en":
        used_lang = "eng"
    elif used_lang == "it":
        used_lang = "ita"

    current_ocr_lang = used_lang

    per_page: list[str] = []
    page_images_bytes: list[bytes] = []

    for f in files:
        try:
            contents = await f.read()
            if not contents:
                per_page.append("")
                continue
            if len(contents) > 10 * 1024 * 1024:
                per_page.append("")
                continue

            img = Image.open(io.BytesIO(contents)).convert("RGB")
            bio = io.BytesIO()
            img.save(bio, format="JPEG", quality=90)
            page_images_bytes.append(bio.getvalue())

            gray = ImageOps.grayscale(img)
            gray = ImageOps.autocontrast(gray)
            txt = pytesseract.image_to_string(gray, lang=used_lang).strip()
            per_page.append(txt)
        except Exception:
            per_page.append("")

    if return_pdf:
        try:
            pdf_bytes = img2pdf.convert(page_images_bytes)
            return StreamingResponse(
                io.BytesIO(pdf_bytes),
                media_type="application/pdf",
                headers={"Content-Disposition": 'attachment; filename="ocr_pages.pdf"'},
            )
        except Exception:
            pass

    combined = "\n\n=== PAGE BREAK ===\n\n".join(per_page).strip()
    return {
        "text": combined,
        "pages": per_page,
        "page_count": len(per_page),
        "lang_used": used_lang,
    }

@app.post("/ocr_extract")
async def ocr_extract(
    files: Optional[List[UploadFile]] = File(
        None, description="Multiple images (use key 'files')"
    ),
    file: Optional[UploadFile] = File(
        None, description="Single image (use key 'file')"
    ),
    lang: Optional[str] = Query(
        None, description="Tesseract language code(s), e.g. eng, ita"
    ),
    return_pdf: bool = Query(
        False,
        description="If true, return assembled PDF instead of JSON",
    ),
):
    """
    Single/multi image OCR:
    - JSON OCR (default): OCR first image and return text.
    - PDF assembly: if return_pdf=true, return multi-page PDF.
    Tracks current_ocr_lang from effective language.
    """
    global current_ocr_lang

    uploads: List[UploadFile] = []
    if files:
        uploads.extend(files)
    if file:
        uploads.append(file)
    if not uploads:
        raise HTTPException(
            status_code=400,
            detail="No image files uploaded. Use 'file' or 'files'.",
        )

    max_bytes = 10 * 1024 * 1024
    loaded_images = []
    for up in uploads:
        data = await up.read()
        if not data:
            raise HTTPException(
                status_code=400,
                detail=f"Empty file: {up.filename or '(unnamed)'}",
            )
        if len(data) > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File too large (>10 MB): {up.filename}",
            )
        try:
            img = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception as e:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported or corrupted image: {up.filename} ({e})",
            )
        loaded_images.append((up, img))

    if return_pdf:
        if not loaded_images:
            raise HTTPException(
                status_code=400, detail="No valid images to assemble."
            )
        first = loaded_images[0][1]
        rest = [im for _, im in loaded_images[1:]]
        buf = io.BytesIO()
        if rest:
            first.save(buf, format="PDF", save_all=True, append_images=rest)
        else:
            first.save(buf, format="PDF")
        buf.seek(0)
        out_name = (uploads[0].filename or "scan").rsplit(".", 1)[0] + ".pdf"
        headers = {
            "Content-Disposition": f'attachment; filename="{out_name}"'
        }
        return StreamingResponse(
            buf, media_type="application/pdf", headers=headers
        )

    up0, img0 = loaded_images[0]
    gray = ImageOps.grayscale(img0)
    gray = ImageOps.autocontrast(gray)

    lang_eff = (lang or OCR_LANG).strip().lower()
    if lang_eff == "en":
        lang_eff = "eng"
    elif lang_eff == "it":
        lang_eff = "ita"

    current_ocr_lang = lang_eff

    try:
        text = pytesseract.image_to_string(gray, lang=lang_eff)
        return JSONResponse(
            {
                "text": text.strip(),
                "lang_used": lang_eff,
                "filename": up0.filename,
            }
        )
    except Exception as e:
        return JSONResponse(
            {"error": f"OCR failed: {str(e)}"}, status_code=500
        )

# === Corpus endpoints ===
@app.get("/download_corpus_json")
def download_corpus_json():
    json_bytes = io.BytesIO(
        json.dumps(corpus_data, ensure_ascii=False, indent=2).encode("utf-8")
    )
    return StreamingResponse(
        json_bytes,
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="corpus_data.json"'
        },
    )

@app.post("/prepare_corpus")
def prepare_corpus(data: CorpusRequest):
    """
    Build an in-memory corpus and FAISS index from the provided text.

    Effects (global, single active corpus):
      - full_text / indexed_sentences: store the raw text and its sentences.
      - corpus_data: list of entries with chunk, summary, question, embedding, sentence_ids.
      - index: FAISS index over guiding-question embeddings.
    Response:
      - ready: true when a non-empty index is available.
      - chunks: number of entries in corpus_data.
      - message: human-readable status for frontend UI.
    """
    global chunks, summaries, index, corpus_data, latest_filename, full_text, indexed_sentences

    # Reset previous state
    chunks = []
    summaries = []
    index = None
    corpus_data = []
    latest_filename = ""
    full_text = ""
    indexed_sentences = []

    # Basic validation
    text = (data.text or "").strip()
    if not text:
        return {
            "ready": False,
            "chunks": 0,
            "message": "Empty text. Provide non-empty text to prepare corpus.",
        }

    # Step 1: sentences + global text
    sentences = sent_tokenize(text)
    if len(sentences) == 0:
        return {
            "ready": False,
            "chunks": 0,
            "message": "No sentences detected in text.",
        }

    full_text = text
    indexed_sentences = list(enumerate(sentences))

    # Step 2: sliding-window chunks with controlled overlap
    chunk_size = CHUNK_SIZE
    overlap = min(CHUNK_OVERLAP, max(0, CHUNK_SIZE - 1))
    i = 0
    local_chunks = []

    while i < len(indexed_sentences):
        current = indexed_sentences[i : i + chunk_size]
        if not current:
            break
        if len(current) < chunk_size:
            break  # avoid tiny tail chunks
        sentence_ids = [idx for idx, _ in current]
        chunk_text = " ".join(s for _, s in current)
        local_chunks.append((chunk_text, sentence_ids))
        i += max(1, chunk_size - overlap)

    if not local_chunks:
        return {
            "ready": False,
            "chunks": 0,
            "message": "Could not form chunks from text.",
        }

    chunks = local_chunks

    # Step 3: summaries
    summaries = [generate_summary(c[0]) for c in chunks]

    # Step 4: guiding questions + embeddings
    existing_questions = []
    temp = []
    for (chunk_text, sentence_ids), s in zip(chunks, summaries):
        q, emb = generate_question(s, existing_questions)
        if q and emb is not None:
            existing_questions.append(q)
            temp.append(
                {
                    "chunk": str(chunk_text),
                    "summary": str(s),
                    "question": str(q),
                    "embedding": emb,
                    "sentence_ids": [int(x) for x in sentence_ids],
                }
            )

    if not temp:
        return {
            "ready": False,
            "chunks": 0,
            "message": "No guiding questions generated; corpus not usable.",
        }

    # Step 5: (simple) merged view — here we keep 1:1 for clarity
    corpus_entries = []
    for entry in temp:
        emb_vec = (
            embedder.encode(
                [entry["question"]], normalize_embeddings=True
            )[0]
            .astype(np.float32)
            .tolist()
        )
        corpus_entries.append(
            {
                "chunk": entry["chunk"],
                "summary": entry["summary"],
                "question": entry["question"],
                "embedding": emb_vec,
                "full_text": entry["chunk"],
                "sentence_ids": entry["sentence_ids"],
            }
        )

    # Step 6: FAISS index over guiding-question embeddings
    embs = np.array(
        [e["embedding"] for e in corpus_entries],
        dtype=np.float32,
    )
    if embs.size == 0:
        return {
            "ready": False,
            "chunks": 0,
            "message": "No embeddings created; corpus not usable.",
        }

    index_flat = faiss.IndexFlatL2(embs.shape[1])
    index_flat.add(embs)

    if index_flat.ntotal == 0:
        return {
            "ready": False,
            "chunks": 0,
            "message": "Index build failed; corpus not usable.",
        }

    # Step 7: light rerank metadata (top-1 related guiding question per entry)
    for idx_entry, item in enumerate(corpus_entries):
        q = item["question"]
        q_embedding = (
            embedder.encode(
                [q], normalize_embeddings=True
            )[0]
            .astype(np.float32)
        )
        D, I = index_flat.search(
            np.array([q_embedding]), k=5
        )
        candidate_indices = [int(i) for i in I[0] if i >= 0]
        if not candidate_indices:
            continue
        rerank_inputs = [
            (q, corpus_entries[j]["question"])
            for j in candidate_indices
        ]
        rerank_scores = reranker.predict(rerank_inputs)
        best_local = int(np.argmax(rerank_scores))
        best_idx = candidate_indices[best_local]
        best = corpus_entries[best_idx]

        item["reranked_top_chunk"] = best["chunk"]
        item["reranked_top_chunk_idx"] = int(best_idx)
        item["reranked_sentence_ids"] = [
            int(x) for x in best.get("sentence_ids", [])
        ]
        item["reranked_summary"] = best.get("summary", "")

    # Persist in global state (single active corpus)
    corpus_data = to_python_types(corpus_entries)
    globals()["corpus_data"] = corpus_data
    globals()["index"] = index_flat

    return {
        "ready": True,
        "status": "ok",
        "message": "Corpus prepared and ready for queries.",
        "chunks": len(corpus_data),
        "index_size": int(index_flat.ntotal),
    }

@app.get("/get_corpus_json")
def get_corpus_json():
    if not latest_filename or not os.path.isfile(latest_filename):
        raise HTTPException(
            status_code=404,
            detail="No corpus file available on disk.",
        )
    return FileResponse(
        latest_filename, media_type="application/json"
    )

@app.post("/load_corpus_file")
def load_corpus_file(file_path: str):
    global corpus_data, index, latest_filename

    if not os.path.isfile(file_path):
        return {"error": f"File not found: {file_path}"}

    with open(file_path, "r", encoding="utf-8") as f:
        corpus_data = json.load(f)

    embeddings = np.array(
        [q["embedding"] for q in corpus_data], dtype=np.float32
    )
    index_flat = faiss.IndexFlatL2(embeddings.shape[1])
    index_flat.add(embeddings)
    index_load = index_flat

    latest_filename = file_path
    globals()["index"] = index_load

    print(
        f"Corpus loaded: {len(corpus_data)} entries. Index built with {index_load.ntotal} vectors."
    )
    return {
        "status": "Corpus loaded",
        "chunks": len(corpus_data),
        "file": file_path,
    }

@app.post("/clear_corpus")
def clear_corpus():
    global chunks, summaries, index, corpus_data, latest_filename, full_text, indexed_sentences
    chunks = []
    summaries = []
    index = None
    corpus_data = []
    latest_filename = ""
    full_text = ""
    indexed_sentences = []
    return {"status": "cleared"}

@app.post("/query")
def query(data: QueryRequest):
    if index is None or not corpus_data:
        return {"error": "No corpus loaded."}

    q_embedding = (
        embedder.encode(
            [data.question], normalize_embeddings=True
        )[0]
        .astype(np.float32)
    )

    D, I = index.search(
        np.array([q_embedding]), k=5
    )

    # Filter out invalid FAISS indices (e.g. -1 when ntotal < k)
    valid_indices = [int(i) for i in I[0] if int(i) >= 0]
    if not valid_indices:
        return {
            "error": "No valid candidates found in index.",
            "question": data.question,
        }

    candidates = [
        (corpus_data[i]["question"], i) for i in valid_indices
    ]

    rerank_inputs = [
        (data.question, guiding_question)
        for guiding_question, _ in candidates
    ]
    rerank_scores = reranker.predict(rerank_inputs)

    best_local = int(np.argmax(rerank_scores))
    _, chunk_index = candidates[best_local]
    best_score = float(rerank_scores[best_local])

    # Map the rerank choice back to the corresponding FAISS distance
    # (use the distance at the same position within the filtered list)
    # We rebuild a parallel list of distances for the valid indices:
    distances_for_valid = [
        float(D[0][list(I[0]).index(i)]) for i in valid_indices
    ]
    best_distance = distances_for_valid[best_local]

    result = corpus_data[chunk_index]
    return {
        "question": data.question,
        "guiding_question": result["question"],
        "chunk": result["chunk"],
        "summary": result.get("summary", ""),
        "score": float(round(best_score, 4)),
        "cosine_score": float(
            round(1.0 - best_distance / 2.0, 4)
        ),
        "low_confidence": bool(best_score < 0.55),
        "sentence_ids": [
            int(x) for x in result.get("sentence_ids", [])
        ],
        "chunk_index": int(chunk_index),
    }

@app.post("/fallback")
def fallback(data: QueryRequest):
    if not corpus_data:
        return {"error": "Corpus not loaded.", "results": []}

    full = " ".join(
        [item["chunk"] for item in corpus_data]
    )
    sentences = sent_tokenize(full)
    sentence_embeddings = embedder.encode(
        sentences, normalize_embeddings=True
    )
    q_embedding = (
        embedder.encode(
            [data.question], normalize_embeddings=True
        )[0]
        .astype(np.float32)
    )
    scores = np.dot(sentence_embeddings, q_embedding)

    best_idx = int(np.argmax(scores))
    start = max(0, best_idx - 1)
    end = min(len(sentences), best_idx + 2)
    best_chunk = ". ".join(sentences[start:end])

    return {
        "chunk": best_chunk,
        "score": float(round(float(max(scores)), 4)),
        "start_idx": start,
    }


@app.post("/llm_answer_from_chunk")
def llm_answer_from_chunk(data: AnswerRequest):
    if not data.chunk or not data.question:
        return {
            "error": "Both chunk and question are required."
        }

    if not llm_available():
        return {
            "answer": "",
            "note": "LLM disabled (ENABLE_LLM=false). Use retrieval-only mode or enable a local LLM.",
        }

    prompt = (
        "The following passage comes from a document the user uploaded:\n\n"
        f"{data.chunk}\n\n"
        f"Answer the question:\n{data.question}\n\n"
        "Use only the passage above and do not rely on external knowledge."
    )

    response = safe_chat_completion_call(
        client,
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are a precise answerer who only uses the given passage.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0,
    )

    answer = response.choices[0].message.content.strip()
    return {"answer": answer}


@app.post("/llm_fallback_answer")
def llm_fallback_answer(data: QueryRequest):
    if index is None or not corpus_data:
        return {"error": "No corpus loaded."}
    if not data.question:
        return {"error": "Question is required."}

    q_embedding = embedder.encode(
        [data.question], normalize_embeddings=True
    )[0]

    all_sentences = []
    for entry in corpus_data:
        chunk_sentences = sent_tokenize(entry["chunk"])
        all_sentences.extend(chunk_sentences)

    if len(all_sentences) < 3:
        return {
            "error": "Not enough sentences in the corpus for fallback."
        }

    sentence_embeddings = embedder.encode(
        all_sentences, normalize_embeddings=True
    )

    max_score = -1.0
    best_start = 0
    for i in range(len(all_sentences) - 2):
        span = sentence_embeddings[i : i + 3]
        span_avg = (span[0] + span[1] + span[2]) / 3.0
        score = float(
            cosine_similarity(
                [q_embedding], [span_avg]
            )[0][0]
        )
        if score > max_score:
            max_score = score
            best_start = i

    fallback_chunk = " ".join(
        all_sentences[best_start : best_start + 3]
    )

    if not llm_available():
        return {
            "answer": "",
            "fallback_chunk": fallback_chunk,
            "similarity": float(max_score),
            "note": "LLM disabled (ENABLE_LLM=false). Showing fallback context only.",
        }

    prompt = (
        "The following excerpt was extracted from the corpus as the most relevant to answer the user's question.\n\n"
        f"{fallback_chunk}\n\n"
        f"Please answer this question using only the information above:\n{data.question}"
    )

    response = safe_chat_completion_call(
        client,
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are a precise answerer who uses only the provided fallback context.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0,
    )

    return {
        "answer": response.choices[0].message.content.strip(),
        "fallback_chunk": fallback_chunk,
        "similarity": float(max_score),
    }


@app.post("/llm_answer_from_fallback_chunk")
def llm_answer_from_fallback_chunk(data: AnswerRequest):
    if not data.chunk or not data.question:
        return {
            "error": "Both chunk and question are required."
        }

    if not llm_available():
        return {
            "answer": "",
            "note": "LLM disabled (ENABLE_LLM=false). Use retrieval-only mode or enable a local LLM.",
        }

    prompt = (
        "The following passage was selected from the full text as most relevant:\n\n"
        f"{data.chunk}\n\n"
        f"Answer the question:\n{data.question}"
    )

    response = safe_chat_completion_call(
        client,
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "You are a precise answerer who uses only the provided context.",
            },
            {"role": "user", "content": prompt},
        ],
        temperature=0,
    )

    return {"answer": response.choices[0].message.content.strip()}


@app.post("/evaluate")
def evaluate(data: EvaluateRequest):
    import difflib

    openai.api_key = os.getenv("OPENAI_API_KEY")
    llm_model = "gpt-4o"

    test_set = data.test_set
    corpus = data.corpus

    with open(data.corpus_file_path, "r", encoding="utf-8") as f:
        full_text_eval = f.read()

    sentences = nltk.sent_tokenize(full_text_eval)
    corpus_questions = [c["question"] for c in corpus]

    def find_best_match(test_question, corpus_qs):
        tq = test_question.strip().lower()
        cqs = [q.strip().lower() for q in corpus_qs]
        matches = difflib.get_close_matches(
            tq, cqs, n=1, cutoff=0.0
        )
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
        try:
            if llm_available():
                prompt = (
                    "Given the following document split into sentences:\n\n"
                    + "\n".join(
                        f"{j+1}. {sent}"
                        for j, sent in enumerate(sentences)
                    )
                    + "\n\nFor the question below, extract the shortest possible consecutive span "
                    "(up to 3 sentences) that completely answers the question. "
                    "Return ONLY the sentence numbers (starting from 1), separated by commas, "
                    "and then the extracted text on the next line.\n\n"
                    f"Question: {question}\n"
                    "Answer:"
                )
                response = safe_chat_completion_call(
                    client,
                    model=llm_model,
                    messages=[
                        {
                            "role": "system",
                            "content": "You are a helpful assistant for extracting answer spans.",
                        },
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=512,
                    temperature=0,
                )
                answer = response.choices[0].message.content.strip()
                lines = answer.splitlines()
                first_line = lines[0] if lines else ""
                sentence_nums = [
                    int(s.strip()) - 1
                    for s in first_line.replace(".", "").split(",")
                    if s.strip().isdigit()
                ]
                oracle_span = (
                    " ".join(sentences[idx] for idx in sentence_nums)
                    if sentence_nums
                    else ""
                )
            else:
                sents = sentences
                if len(sents) < 3:
                    sentence_nums = list(range(len(sents)))
                    oracle_span = " ".join(sents)
                else:
                    q_emb = (
                        embedder.encode(
                            [question], normalize_embeddings=True
                        )[0]
                    )
                    sent_embs = embedder.encode(
                        sents, normalize_embeddings=True
                    )
                    best_score, best_i = -1.0, 0
                    for i in range(len(sents) - 2):
                        span_avg = (
                            sent_embs[i]
                            + sent_embs[i + 1]
                            + sent_embs[i + 2]
                        ) / 3.0
                        score = float(
                            cosine_similarity(
                                [q_emb], [span_avg]
                            )[0][0]
                        )
                        if score > best_score:
                            best_score, best_i = score, i
                    sentence_nums = [
                        best_i,
                        best_i + 1,
                        best_i + 2,
                    ]
                    oracle_span = " ".join(
                        sents[i] for i in sentence_nums
                    )
        except Exception as e:
            print(
                f"ORACLE ERROR for question {repr(question)}: {e}"
            )
            sentence_nums = []
            oracle_span = ""

        if not sentence_nums:
            results.append(
                {
                    "question": question,
                    "oracle_sentence_ids": [],
                    "oracle_span": "",
                    "ecosearch_chunk_indices": [],
                    "ecosearch_chunk_text": "",
                    "overlap": "NONE",
                }
            )
            n_none += 1
            continue

        idx_match = find_best_match(
            question, corpus_questions
        )
        ecosearch_entry = (
            corpus[idx_match] if idx_match is not None else None
        )
        chunk_indices = (
            ecosearch_entry.get(
                "reranked_sentence_ids", []
            )
            if ecosearch_entry
            else []
        )
        chunk_text = (
            ecosearch_entry.get(
                "reranked_top_chunk", ""
            )
            if ecosearch_entry
            else ""
        )

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

        results.append(
            {
                "question": question,
                "oracle_sentence_ids": sentence_nums,
                "oracle_span": oracle_span,
                "ecosearch_chunk_indices": chunk_indices,
                "ecosearch_chunk_text": chunk_text,
                "overlap": overlap,
            }
        )

    return {
        "n_questions": len(test_set),
        "full": n_full,
        "partial": n_partial,
        "none": n_none,
        "results": results,
    }


@app.get("/health")
def health():
    """
    Health check:
    - status
    - LLM availability
    - last effective OCR language (current_ocr_lang)
    - OCR readiness
    """
    try:
        ocr_ready = bool(pytesseract.get_tesseract_version())
    except Exception:
        ocr_ready = False

    return {
        "status": "ok",
        "llm_enabled": ENABLE_LLM,
        "ocr_lang": current_ocr_lang,
        "ocr_ready": ocr_ready,
    }

print(f"✅ OCR ready — using language(s): {OCR_LANG}")

# === Run ===
# uvicorn eco_backend:app --reload --port 8000