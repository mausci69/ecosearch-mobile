from __future__ import annotations
import sys
import json
from pathlib import Path
from statistics import mean
from itertools import chain

def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: python -m eco.preprocess.health_report <path/to/chunk_questions.json>")
        sys.exit(2)

    path = Path(sys.argv[1])
    if not path.exists():
        print(f"File not found: {path}")
        sys.exit(2)

    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        print("Top-level JSON must be a non-empty list of records")
        sys.exit(1)

    n = len(data)
    ids = [r.get("chunk_id", "") for r in data]
    dup_ids = [cid for cid in set(ids) if ids.count(cid) > 1]

    chars_per_chunk = [len((r.get("chunk_text") or "")) for r in data]
    sents_per_chunk = [len((r.get("sentence_indices") or [])) for r in data]
    all_indices = list(chain.from_iterable((r.get("sentence_indices") or []) for r in data))

    print("=== Health Report ===")
    print(f"Records: {n}")
    print(f"Unique chunk_ids: {len(set(ids))}  (duplicates: {len(dup_ids)})")
    if dup_ids:
        print(f"  Duplicated IDs: {sorted(dup_ids)[:10]}{' …' if len(dup_ids) > 10 else ''}")

    print(f"Avg chars/chunk: {int(mean(chars_per_chunk)) if chars_per_chunk else 0}")
    print(f"Avg sentences/chunk: {round(mean(sents_per_chunk), 2) if sents_per_chunk else 0}")
    print(f"Total sentence indices counted (with overlap): {len(all_indices)}")
    print(f"Distinct sentence indices: {len(set(all_indices))}")

    print("\nSample records:")
    for r in data[:2]:
        cid = r.get("chunk_id")
        txt = (r.get("chunk_text") or "").strip().replace("\n", " ")
        print(f"- {cid}: {txt[:120]}{'…' if len(txt) > 120 else ''}")

if __name__ == "__main__":
    main()
