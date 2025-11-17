from __future__ import annotations
import json
import sys
from pathlib import Path
from typing import List, Dict, Any

REQUIRED_KEYS = {"chunk_id", "sentence_indices", "chunk_text", "summary", "guiding_question"}

def _is_nonempty_str(x: Any) -> bool:
    return isinstance(x, str) and x.strip() != ""

def _validate_sentence_indices(indices: Any) -> str | None:
    if not isinstance(indices, list) or not indices:
        return "sentence_indices must be a non-empty list"
    if not all(isinstance(i, int) for i in indices):
        return "sentence_indices must contain only integers"
    if sorted(indices) != indices:
        return "sentence_indices must be sorted ascending"
    # Contiguous range check (each next is +1)
    if any(b - a != 1 for a, b in zip(indices, indices[1:])):
        return "sentence_indices must be contiguous (no gaps)"
    return None

def validate_record(rec: Dict[str, Any], idx: int) -> List[str]:
    errs: List[str] = []
    missing = REQUIRED_KEYS - rec.keys()
    if missing:
        errs.append(f"missing keys: {sorted(missing)}")

    if "chunk_id" in rec and not _is_nonempty_str(rec["chunk_id"]):
        errs.append("chunk_id must be a non-empty string")

    if "chunk_text" in rec and not _is_nonempty_str(rec["chunk_text"]):
        errs.append("chunk_text must be a non-empty string")

    if "summary" in rec and not _is_nonempty_str(rec["summary"]):
        errs.append("summary must be a non-empty string")

    if "guiding_question" in rec and not _is_nonempty_str(rec["guiding_question"]):
        errs.append("guiding_question must be a non-empty string")

    if "sentence_indices" in rec:
        msg = _validate_sentence_indices(rec["sentence_indices"])
        if msg:
            errs.append(msg)

    # Optional: enforce conventional id pattern
    cid = rec.get("chunk_id")
    if isinstance(cid, str) and not cid.startswith("chunk_"):
        errs.append("chunk_id should start with 'chunk_'")

    return errs

def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m eco.preprocess.validate_chunk_questions <path/to/chunk_questions.json>")
        sys.exit(2)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(2)

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        print("Top-level JSON must be a non-empty list of records")
        sys.exit(1)

    total_errs = 0
    for i, rec in enumerate(data):
        errs = validate_record(rec, i)
        if errs:
            total_errs += 1
            print(f"[ERROR] record #{i} (chunk_id={rec.get('chunk_id')}):")
            for e in errs:
                print(f"  - {e}")

    if total_errs == 0:
        print(f"OK ✓  {len(data)} records validated")
        sys.exit(0)
    else:
        print(f"Failed ✗  {total_errs} records have errors")
        sys.exit(1)

if __name__ == "__main__":
    main()
