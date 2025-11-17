# sent_counter.py
# Usage:
# python sent_counter.py chunk_questions_28082025_151308.json
# (Optional 2nd arg = custom snippet to search)

import sys, json, re

DEFAULT_SNIPPET = (
    "Closed-book question answering is when a system has memorized some facts during training "
    "and can answer questions without explicitly being given a context. "
    "This is similar to humans taking closed-book exams."
)

def norm(s: str) -> str:
    s = s.lower().replace("•"," ").replace("–","-").replace("—","-").replace("closed-book","closed book")
    s = re.sub(r"[^a-z0-9\s\.!?]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def sent_split(t: str):
    t = t.replace("•", ". ")  # treat bullets as sentence ends
    parts = [p.strip() for p in re.split(r'(?<=[.!?])\s+', t) if p.strip()]
    return parts

def iter_entries(doc):
    if isinstance(doc, dict):
        for k in ("chunks","items","data","entries"):
            if isinstance(doc.get(k), list):
                for e in doc[k]: yield e
                return
        for v in doc.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                for e in v: yield e
                return
    elif isinstance(doc, list):
        for e in doc: yield e

def get_text(e):
    for k in ("chunk_text","text","content","chunk","body"):
        v = e.get(k)
        if isinstance(v, str) and v.strip(): return v
    return ""

def main():
    if len(sys.argv) < 2:
        print("Usage: python tools/sent_counter.py /path/to/chunk_questions.json [snippet]")
        sys.exit(1)
    path = sys.argv[1]
    snippet = sys.argv[2] if len(sys.argv) >= 3 else DEFAULT_SNIPPET

    doc = json.load(open(path, "r", encoding="utf-8"))
    entries = list(iter_entries(doc)) or []
    needle_n = norm(snippet)

    for i, e in enumerate(entries):
        txt = get_text(e)
        if not txt: 
            continue
        if needle_n in norm(txt):
            sents = sent_split(txt)
            print(f"FOUND at index={i}, chunk_id={e.get('chunk_id')}")
            print(f"sentence_count={len(sents)}")
            for j, s in enumerate(sents, 1):
                print(f"{j}) {s}")
            break
    else:
        print("NOT FOUND")

if __name__ == "__main__":
    main()
