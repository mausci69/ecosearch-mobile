import numpy as np
from typing import Dict, List, Any, Tuple

def compute_reranked_top_chunk(
    question: str,
    q_emb: np.ndarray,
    chunks: List[Dict[str, Any]],
    faiss_index,
    cross_encoder,
    top_k_faiss: int = 5,
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], List[float]]:
    """
    Retrieve FAISS top-k candidates for the question embedding, rerank with CrossEncoder,
    and return (best_chunk, candidates, rerank_scores).
    """
    # FAISS search (expects float32)
    q = np.array([q_emb], dtype=np.float32)
    _, indices = faiss_index.search(q, top_k_faiss)
    candidates: List[Dict[str, Any]] = [chunks[i] for i in indices[0]]

    # Rerank with CrossEncoder on (question, chunk_text)
    pairs = [(question, c.get("text", "")) for c in candidates]
    scores = cross_encoder.predict(pairs).tolist()  # type: ignore

    best_idx = int(np.argmax(scores))
    best_chunk = candidates[best_idx]
    return best_chunk, candidates, scores

