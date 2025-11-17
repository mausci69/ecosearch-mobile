#!/usr/bin/env python3
import argparse
from pathlib import Path
import sys
import yaml
import json
import csv
from datetime import datetime
import random
import shutil

try:
    import numpy as np
except ImportError:
    np = None

try:
    import torch
except ImportError:
    torch = None

def run_cmd(args: argparse.Namespace) -> int:
    print("ecosearch-eval :: run")
    print(f"  test_set        : {args.test_set}")
    print(f"  chunk_questions : {args.chunk_questions}")
    print(f"  full_text       : {args.full_text}")

    policy_path = Path("config/policy.yaml").resolve()
    if not policy_path.exists():
        print(f"ERRORE: policy.yaml non trovato in {policy_path}")
        return 1
    with open(policy_path, "r") as f:
        policy = yaml.safe_load(f)
    policy_id = policy.get("policy_id", "unknown")
    print(f"Policy caricata (policy_id = {policy_id})")

    # === Seeds (riproducibilità) ===
    seed = 42
    random.seed(seed)
    if np is not None:
        np.random.seed(seed)
    if torch is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)

    # === Output results (placeholder finché non colleghiamo il motore di eval) ===
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = Path("eval_runs") / ts
    run_dir.mkdir(parents=True, exist_ok=False)

    # === Snapshot policy & parametri del run (riproducibilità) ===
    shutil.copy2(policy_path, run_dir / "policy_snapshot.yaml")
    params = {
        "timestamp": ts,
        "seed": seed,
        "policy_id": policy_id,
        "inputs": {
            "test_set": str(args.test_set),
            "chunk_questions": str(args.chunk_questions),
            "full_text": str(args.full_text),
        },
        "versions": {
            "python": sys.version,
        },
    }
    with open(run_dir / "run_params.json", "w", encoding="utf-8") as pf:
        json.dump(params, pf, ensure_ascii=False, indent=2)

    # === Scrittura risultati placeholder (JSONL, CSV, report) ===
    results = [
        {"qid": 1, "question": "dummy Q1", "retrieved": "chunkA", "oracle": "spanX", "overlap": "FULL"},
        {"qid": 2, "question": "dummy Q2", "retrieved": "chunkB", "oracle": "spanY", "overlap": "PARTIAL"},
    ]

    jsonl_path = run_dir / "results.jsonl"
    with open(jsonl_path, "w", encoding="utf-8") as jf:
        for row in results:
            jf.write(json.dumps(row, ensure_ascii=False) + "\n")

    csv_path = run_dir / "results.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as cf:
        writer = csv.DictWriter(cf, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)

    report_path = run_dir / "report.txt"
    full = sum(1 for r in results if r["overlap"] == "FULL")
    partial = sum(1 for r in results if r["overlap"] == "PARTIAL")
    none = len(results) - full - partial
    with open(report_path, "w", encoding="utf-8") as rf:
        rf.write(f"EcoSearch Eval Report ({ts})\n")
        rf.write(f"policy_id: {policy_id}\n")
        rf.write(f"seed: {seed}\n")
        rf.write(f"FULL: {full} | PARTIAL: {partial} | NONE: {none}\n")

    print(f"Risultati salvati in: {run_dir}")
    print(f"- {jsonl_path.name}")
    print(f"- {csv_path.name}")
    print(f"- {report_path.name}")
    return 0

    # Dati fittizi per verificare il flusso di scrittura
    results = [
        {"qid": 1, "question": "dummy Q1", "retrieved": "chunkA", "oracle": "spanX", "overlap": "FULL"},
        {"qid": 2, "question": "dummy Q2", "retrieved": "chunkB", "oracle": "spanY", "overlap": "PARTIAL"},
    ]

    # JSONL
    jsonl_path = run_dir / "results.jsonl"
    with open(jsonl_path, "w", encoding="utf-8") as jf:
        for row in results:
            jf.write(json.dumps(row, ensure_ascii=False) + "\n")

    # CSV
    csv_path = run_dir / "results.csv"
    with open(csv_path, "w", newline="", encoding="utf-8") as cf:
        writer = csv.DictWriter(cf, fieldnames=list(results[0].keys()))
        writer.writeheader()
        writer.writerows(results)

    # Report breve
    report_path = run_dir / "report.txt"
    full = sum(1 for r in results if r["overlap"] == "FULL")
    partial = sum(1 for r in results if r["overlap"] == "PARTIAL")
    none = len(results) - full - partial
    with open(report_path, "w", encoding="utf-8") as rf:
        rf.write(f"EcoSearch Eval Report ({ts})\n")
        rf.write(f"policy_id: {policy_id}\n")
        rf.write(f"FULL: {full} | PARTIAL: {partial} | NONE: {none}\n")

    print(f"Risultati salvati in: {run_dir}")
    print(f"- {jsonl_path.name}")
    print(f"- {csv_path.name}")
    print(f"- {report_path.name}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="ecosearch-eval",
        description="EcoSearch — Evaluation CLI"
    )
    sub = p.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Esegui una valutazione su un test set")
    run.add_argument("--test-set", "-t", type=_existing_file, required=True,
                     help="Path al file test_set.json")
    run.add_argument("--chunk-questions", "-c", type=_existing_file, required=True,
                     help="Path al file chunk_questions.json")
    run.add_argument("--full-text", "-f", type=_existing_file, required=True,
                     help="Path al file di testo completo (corpus sorgente)")
    run.set_defaults(func=run_cmd)

    return p

def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)

if __name__ == "__main__":
    sys.exit(main())

