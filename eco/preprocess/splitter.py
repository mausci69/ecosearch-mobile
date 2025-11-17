import re
from typing import List, Dict
from nltk.tokenize import sent_tokenize

def split_into_chunks(text: str, max_sentences: int = 5, overlap: int = 0) -> List[Dict]:
    """
    Split text into sentence-based chunks, keeping track of sentence indices.
    Cleans out empty and punctuation-only artefacts.

    Returns: [{"chunk_text": str, "sentence_indices": [int, ...]}, ...]
    """
    # Normalise overlap to ensure forward progress
    if overlap >= max_sentences:
        overlap = max(0, max_sentences - 1)

    sentences = [s.strip() for s in sent_tokenize(text)]
    sentences = [s for s in sentences if s and re.search(r"\w", s)]

    chunks: List[Dict] = []
    i = 0
    while i < len(sentences):
        end = min(i + max_sentences, len(sentences))
        chunk_text = " ".join(sentences[i:end]).strip()
        sentence_indices = list(range(i, end))
        if chunk_text:
            chunks.append({
                "chunk_text": chunk_text,
                "sentence_indices": sentence_indices,
            })
        i = end - overlap if overlap > 0 else end
    return chunks
