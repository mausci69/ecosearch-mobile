#!/usr/bin/env bash
set -euo pipefail

BACKEND="${ECO_BACKEND_URL:-http://localhost:8000}"
JSON="${1:-chunk_questions.json}"
TOPK="${2:-5}"
N="${3:-2}"

python -m eco.checks.quick_query_test \
  --backend "${BACKEND}" \
  --json "${JSON}" \
  --top-k "${TOPK}" \
  --n "${N}"
