from __future__ import annotations
import os
import json
import argparse
from pathlib import Path
import requests

def _env_backend_url() -> str:
    return os.environ.get("ECO_BACKEND_URL", "http://localhost:8000").rstrip("/")

def _pick_sample_questions(path: Path, k: int = 2) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    qs = []
    for rec in data:
        q = (rec.get("guiding_question") or "").strip()
        if q:
            qs.append(q)
        if len(qs) >= k:
            break
    return qs

def _print_result(resp_json: dict) -> None:
    agent = resp_json.get("agent_decision") or {}
    action = agent.get("action") or resp_json.get("recommended_action") or "?"
    confidence = (agent.get("confidence") or agent.get("confidence_label") or "low").lower()

    top_chunk = resp_json.get("top_chunk") or {}
    chunk_id = top_chunk.get("chunk_id") or resp_json.get("top_chunk_id") or "n/a"
    score = top_chunk.get("score") or resp_json.get("similarity") or "n/a"
    text = top_chunk.get("text") or resp_json.get("top_chunk_text") or ""

    print(f"Agent: action={action}, confidence={confidence}")
    print(f"Top chunk: id={chunk_id}, score={score}")
    if text:
        preview = " ".join(str(text).split())[:160]
        print(f"Preview: {preview}{'…' if len(text) > 160 else ''}")

def main() -> None:
    ap = argparse.ArgumentParser(description="Quick sanity check: call /query with 1–2 sample questions.")
    ap.add_argument("--backend", "-b", type=str, default=_env_backend_url(),
                    help="Backend base URL (default: ECO_BACKEND_URL or http://localhost:8000)")
    ap.add_argument("--json", "-j", type=Path, required=True,
                    help="Path to chunk_questions.json previously generated")
    ap.add_argument("--top-k", type=int, default=5, help="Retriever top_k to request (default: 5)")
    ap.add_argument("--n", type=int, default=2, help="How many questions to test (default: 2)")
    args = ap.parse_args()

    base = args.backend.rstrip("/")
    url = f"{base}/query"

    samples = _pick_sample_questions(args.json, k=max(1, args.n))
    if not samples:
        raise SystemExit("No guiding questions found in JSON.")

    print(f"Backend: {url}")
    print(f"Testing {len(samples)} question(s)…\n")

    for i, q in enumerate(samples, 1):
        print(f"== Q{i}: {q}")
        try:
            payload = {"question": q, "top_k": args.top_k}
            r = requests.post(url, json=payload, timeout=30)
            r.raise_for_status()
            resp_json = r.json()
            _print_result(resp_json)
        except requests.RequestException as e:
            print(f"[HTTP ERROR] {e}")
        except Exception as e:
            print(f"[ERROR] {e}")
        print()

if __name__ == "__main__":
    main()
