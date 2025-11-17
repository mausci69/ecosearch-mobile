// apps/mobile/src/local/prepareCorpus.ts
// British English comments.
// Minimal, production-ready skeleton for offline "prepareCorpus":
// - Deterministic sentence splitter
// - Simple fixed-size sentence chunker
// - Pure functions (no I/O); persistence will arrive in step 3/6

export type Sentence = {
  id: number;      // stable, 0-based within the document
  text: string;    // exact slice from input (trimmed of outer spaces)
  start: number;   // char offset in original text (inclusive)
  end: number;     // char offset in original text (exclusive)
};

export type Chunk = {
  id: number;           // stable, 0-based
  startSentence: number; // inclusive sentence index
  endSentence: number;   // exclusive sentence index
  text: string;          // concatenated sentence texts
};

export type PrepareOptions = {
  docId?: string;
  // Target number of sentences per chunk. Kept simple for step 1/6.
  sentencesPerChunk?: number; // default 4
};

export type PrepareResult = {
  docId: string;
  sentences: Sentence[];
  chunks: Chunk[];
};

/**
 * Deterministic, punctuation-based sentence splitter.
 * Rules:
 *  - Normalises Windows newlines to "\n".
 *  - Splits on ., !, ? when followed by space/newline or end of text.
 *  - Avoids splitting on very short tokens like "e.g.", "Mr.", "Dr.".
 */
export function splitDeterministic(raw: string): Sentence[] {
  const text = raw.replace(/\r\n?/g, "\n");
  const sentences: Sentence[] = [];

  let start = 0;
  let sid = 0;

  const push = (sStart: number, sEnd: number) => {
    const slice = text.slice(sStart, sEnd).trim();
    if (slice.length === 0) return;
    // Re-compute trimmed offsets to keep start/end correct after trim.
    const leading = text.slice(sStart, sEnd).match(/^\s*/)?.[0].length ?? 0;
    const trailing = text.slice(sStart, sEnd).match(/\s*$/)?.[0].length ?? 0;
    const absStart = sStart + leading;
    const absEnd = sEnd - trailing;
    sentences.push({ id: sid++, text: text.slice(absStart, absEnd), start: absStart, end: absEnd });
  };

  // Scan characters and find ends of sentences.
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (ch === "." || ch === "!" || ch === "?") {
      const prev = pickTokenBefore(text, i);
      const next = text[i + 1] ?? "";
      const next2 = text[i + 2] ?? "";

      const veryShortToken = prev.length > 0 && prev.length <= 3;
      const looksAbbrev =
        veryShortToken &&
        // e.g., "e.g." or "Mr." → usually followed by lower or letter
        (/[a-z]/.test(next) || /[a-z]/.test(next2));

      const boundaryFollows = next === " " || next === "\n" || next === "";

      if (!looksAbbrev && boundaryFollows) {
        // Sentence boundary at i (inclusive of punctuation)
        push(start, i + 1);
        // Skip trailing spaces/newlines to set next start.
        let j = i + 1;
        while (j < text.length && (text[j] === " " || text[j] === "\n" || text[j] === "\t")) j++;
        start = j;
      }
    }
  }

  // Tail
  if (start < text.length) push(start, text.length);

  // Re-index to ensure dense ids starting at 0 (in case of blank tails)
  return sentences.map((s, idx) => ({ ...s, id: idx }));
}

function pickTokenBefore(s: string, idx: number): string {
  // Walk left to pick the immediate alphabetic token before position idx.
  let i = idx - 1;
  // Skip spaces
  while (i >= 0 && /\s/.test(s[i])) i--;
  // Collect letters backwards
  let token = "";
  while (i >= 0 && /[A-Za-z]/.test(s[i])) {
    token = s[i] + token;
    i--;
  }
  return token;
}

/**
 * Naïve fixed-size chunker by sentence count.
 * Keeps stable sentence index ranges to support later evaluation overlays.
 */
export function makeChunks(sentences: Sentence[], sentencesPerChunk = 4): Chunk[] {
  const chunks: Chunk[] = [];
  if (sentences.length === 0) return chunks;

  let cid = 0;
  for (let i = 0; i < sentences.length; i += sentencesPerChunk) {
    const startSentence = i;
    const endSentence = Math.min(i + sentencesPerChunk, sentences.length);
    const text = sentences.slice(startSentence, endSentence).map(s => s.text).join(" ");
    chunks.push({ id: cid++, startSentence, endSentence, text });
  }
  return chunks;
}

/**
 * Prepare a corpus locally from raw text.
 * This is pure and side-effect free (no storage). Persistence is step 3/6.
 */
export function prepareCorpusLocal(raw: string, opts: PrepareOptions = {}): PrepareResult {
  const docId = opts.docId ?? `local-${Date.now()}`;
  const sentences = splitDeterministic(raw);
  const chunks = makeChunks(sentences, opts.sentencesPerChunk ?? 4);
  return { docId, sentences, chunks };
}

