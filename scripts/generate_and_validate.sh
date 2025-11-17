#!/usr/bin/env bash
set -euo pipefail

INPUT_TXT="${1:-corpus.txt}"
OUTPUT_JSON="${2:-chunk_questions.json}"
MAX_SENTENCES="${3:-5}"
OVERLAP="${4:-0}"

python -m eco.preprocess.run_generation \
  --input "${INPUT_TXT}" \
  --output "${OUTPUT_JSON}" \
  --max-sentences "${MAX_SENTENCES}" \
  --overlap "${OVERLAP}"

python -m eco.preprocess.validate_chunk_questions "${OUTPUT_JSON}"
python -m eco.preprocess.health_report "${OUTPUT_JSON}"
