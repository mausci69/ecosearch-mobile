# tools/find_fallback_chunk.py
# Usage:
#   python tools/check_chunk_questions.py /Users/maurizioscibilia/Python/job_scout_agent/QA/ecosearch/chunk_questions_040725-123312.json
#
# It searches your JSON for the fallback passage (below) and prints:
# - exact/normalised substring matches
# - top 5 fuzzy matches if no exact-normalised hit is found

import sys, json, re
from difflib import SequenceMatcher

FALLBACK_SNIPPET = (
    "Closed-book question answering is when a system has memorized some facts during training "
    "and can answer questions without explicitly being given a context. "
    "This is similar to humans taking closed-book exams."
)

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def iter_entries(doc):
    # Accept common schemas: dict with list under known keys, or a list of entries
    if isinstance(doc, dict):
        for k in ("chunks", "items", "data", "entries"):
            v = doc.get(k)
            if isinstance(v, list):
                for e in v: yield e
                return
        # fallback: any list-like value of dicts
        for v in doc.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                for e in v: yield e
                return
        return
    if isinstance(doc, list):
        for e in doc: yield e

def get_text(e):
    for k in ("chunk_text","text","chunk","content","body"):
        v = e.get(k)
        if isinstance(v, str) and v.strip(): return v
    return ""

def get_id(e):
    for k in ("chunk_id","id","idx","index","uid"):
        if k in e: return e[k]
    return None

def get_questions(e):
    for k in ("guiding_questions","questions","q_list","qs"):
        v = e.get(k)
        if isinstance(v, list): return [str(x) for x in v if str(x).strip()]
    for k in ("question","q"):
        v = e.get(k)
        if isinstance(v, str) and v.strip(): return [v]
    return []

def norm(s):
    # Lower, remove bullets, hyphens, punctuation, collapse spaces
    s = s.lower()
    s = s.replace("•", " ")
    s = s.replace("–", "-").replace("—", "-")
    s = s.replace("closed-book", "closed book")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def ratio(a, b):
    return SequenceMatcher(None, a, b).ratio()

def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/find_fallback_chunk.py /path/to/chunk_questions.json")
        sys.exit(1)
    path = sys.argv[1]
    doc = load_json(path)
    entries = list(iter_entries(doc)) or []
    print(f"entries={len(entries)}")

    needle = norm(FALLBACK_SNIPPET)
    hits = []
    scored = []

    for i, e in enumerate(entries):
        t = get_text(e)
        tn = norm(t)
        if needle and needle in tn:
            hits.append((i, e, "substring"))
        else:
            # store fuzzy score to show top-5 if no exact-normalised hit
            scored.append((i, e, ratio(needle, tn)))

    if hits:
        print(f"\nFOUND {len(hits)} exact-normalised substring match(es):")
        for i, e, how in hits[:10]:
            cid = get_id(e)
            qs = get_questions(e)
            preview = get_text(e).strip().replace("\n"," ")[:220]
            print("\n--- MATCH ---")
            print("index:", i, "chunk_id:", cid, "how:", how)
            print("text:", preview)
            print("questions:", qs)
        return

    print("\nNo exact-normalised substring match. Showing top 5 fuzzy matches:")
    top = sorted(scored, key=lambda x: x[2], reverse=True)[:5]
    for i, e, sc in top:
        cid = get_id(e)
        qs = get_questions(e)
        preview = get_text(e).strip().replace("\n"," ")[:220]
        print("\n--- CANDIDATE ---")
        print(f"index: {i}  chunk_id: {cid}  similarity: {sc:.3f}")
        print("text:", preview)
        print("questions:", qs)

if __name__ == "__main__":
    main()
