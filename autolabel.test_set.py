import json
import numpy as np
from sentence_transformers import SentenceTransformer

# === Config ===
CORPUS_FILE = "chunk_questions_030725-123930.json"
TEST_FILE = "test_set_ground_truth.json"
OUTPUT_FILE = "test_set_with_indices.json"
THRESHOLD = 0.75

# === Load ===
with open(CORPUS_FILE, encoding="utf-8") as f:
    corpus = json.load(f)

with open(TEST_FILE, encoding="utf-8") as f:
    test_set = json.load(f)

print(f"Corpus chunks: {len(corpus)}")
print(f"Test questions: {len(test_set)}\n")

# === Model ===
embedder = SentenceTransformer("all-mpnet-base-v2")

# === Prepare corpus embeddings ===
corpus_questions = [item["question"] for item in corpus]
corpus_embs = np.array([item["embedding"] for item in corpus], dtype=np.float32)
corpus_embs /= np.linalg.norm(corpus_embs, axis=1, keepdims=True)

# === Auto-label with verbose pairing ===
labeled_test_set = []

for idx, test_item in enumerate(test_set, 1):
    test_q = test_item["question"]
    test_emb = embedder.encode([test_q], normalize_embeddings=True)[0].astype(np.float32)
    sims = np.dot(corpus_embs, test_emb)

    # Max similarity & best index
    max_idx = int(np.argmax(sims))
    max_sim = float(sims[max_idx])
    best_corpus_q = corpus_questions[max_idx]

    # Indici sopra soglia
    matching_indices = [i for i, sim in enumerate(sims) if sim >= THRESHOLD]

    labeled_test_set.append({
        "question": test_q,
        "correct_chunk_indices": matching_indices
    })

    print(f"[{idx}] TEST: {test_q}")
    print(f"  BEST MATCH (idx {max_idx}): {best_corpus_q}")
    print(f"  MAX SIM: {max_sim:.4f}")
    print(f"  Indices above threshold ({THRESHOLD}): {matching_indices}\n")

# === Save labeled set ===
with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
    json.dump(labeled_test_set, f, indent=2, ensure_ascii=False)

print(f"\n✅ Labeled test set saved as: {OUTPUT_FILE}")
