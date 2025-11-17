from typing import List, Dict, Any, Callable
import json

from eco.preprocess.splitter import split_into_chunks

def build_chunk_question_records(
    text: str,
    summarise_chunk: Callable[[str], str],
    make_guiding_question: Callable[[str], str],
    max_sentences: int = 5,
    overlap: int = 0,
) -> List[Dict[str, Any]]:
    """
    Create records with sentence indices preserved.
    """
    chunks = split_into_chunks(text, max_sentences=max_sentences, overlap=overlap)
    records: List[Dict[str, Any]] = []
    for idx, ch in enumerate(chunks):
        chunk_text = ch["chunk_text"]
        sentence_indices = ch["sentence_indices"]

        summary = summarise_chunk(chunk_text)
        question = make_guiding_question(summary)

        records.append({
            "chunk_id": f"chunk_{idx}",
            "sentence_indices": sentence_indices,
            "chunk_text": chunk_text,
            "summary": summary,
            "guiding_question": question,
        })
    return records

def write_chunk_questions_json(records: List[Dict[str, Any]], out_path: str) -> None:
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)
