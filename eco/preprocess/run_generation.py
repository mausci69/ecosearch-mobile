import argparse
from pathlib import Path
from typing import List, Dict, Any

from eco.preprocess.splitter import split_into_chunks
from eco.preprocess.generate_chunk_questions import (
    build_chunk_question_records,
    write_chunk_questions_json,
)

# --- Simple, local heuristics (replace with your LLM hooks when needed) ---

def summarise_chunk(chunk_text: str, max_len: int = 240) -> str:
    """
    Produce a terse summary by trimming to ~max_len characters
    and ensuring it ends cleanly. British English comments.
    """
    text = " ".join(chunk_text.split())
    if len(text) <= max_len:
        return text
    cut = text[:max_len]
    # try to end at a sensible boundary
    for sep in (". ", "; ", ": ", ", "):
        i = cut.rfind(sep)
        if i > max_len * 0.6:
            return cut[: i + len(sep.strip())].strip()
    return cut.strip() + "…"

def make_guiding_question(summary: str) -> str:
    """
    Turn a short summary into a guiding question.
    Extremely lightweight; swap with your LLM-based generator when ready.
    """
    s = summary.strip().rstrip(".;:")
    if not s:
        return "What is the main idea of this section?"
    return f"What is this section mainly about: {s}?"

# --- CLI ---

def main() -> None:
    ap = argparse.ArgumentParser(description="Regenerate chunk_questions.json wi_
