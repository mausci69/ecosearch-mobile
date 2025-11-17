// apps/mobile/src/local/retrieval.ts
// British English comments.
// Local retrieval without TFJS: simple bag-of-words embeddings + cosine similarity.
// Pure functions; no I/O. Wiring to UI comes in step 5/6.

import type { PrepareResult, Chunk } from "./prepareCorpus";

export type BoWIndex = {
  docId: string;
  vocab: Map<string, number>; // token -> column index
  chunkVectors: Float32Array[]; // one TF vector per chunk
  chunks: Chunk[]; // original chunks (for text + indices)
};

export type RetrieveOptions = {
  minTokenLength?: number; // default 2
  stopwords?: Set<string>;
};

export type RetrieveResult = {
  chunk_index: number;
  chunk: string;
  sentence_ids: number[]; // expanded sentence id range for compatibility
  score: number;          // same as cosine_score
  cosine_score: number;   // explicit duplicate for API parity
};

const DEFAULT_STOPWORDS = new Set<string>([
  // EN
  "the","a","an","and","or","but","if","then","else","when","while","to","of","in",
  "on","for","with","as","by","at","from","that","this","these","those","is","are",
  "was","were","be","been","being","it","its","into","about","than","so","not",
  "no","yes","can","could","should","would","do","does","did","done","over","under",
  // IT
  "il","lo","la","i","gli","le","un","uno","una","e","o","ma","se","allora","mentre",
  "di","a","da","in","con","su","per","tra","fra","è","era","sono","sei","siamo",
  "siete","stato","stata","stati","state","non","sì","che","questo","questa","queste",
  "quello","quella","quelli","quelle","nel","nella","della","delle","degli","dei"
]);

/** Tokenise a string into normalised tokens, filtering stopwords and short tokens. */
export function tokenise(
  text: string,
  opts: RetrieveOptions = {}
): string[] {
  const minLen = opts.minTokenLength ?? 2;
  const sw = opts.stopwords ?? DEFAULT_STOPWORDS;
  // Lowercase, split on non-letters/digits, keep unicode letters/numbers.
  const raw = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics for rough matching

  const tokens = raw.split(/[^a-z0-9àèéìíòóùú]+/i).filter(t => t.length >= minLen);
  return tokens.filter(t => !sw.has(t));
}

/** Build a vocabulary map from all chunk texts. */
function buildVocabFromChunks(chunks: Chunk[], opts?: RetrieveOptions): Map<string, number> {
  const vocab = new Map<string, number>();
  for (const c of chunks) {
    for (const tok of tokenise(c.text, opts)) {
      if (!vocab.has(tok)) vocab.set(tok, vocab.size);
    }
  }
  return vocab;
}

/** Vectorise tokens into a TF (term-frequency) vector over the given vocab. */
function vectorise(tokens: string[], vocab: Map<string, number>): Float32Array {
  const vec = new Float32Array(vocab.size || 1);
  for (const t of tokens) {
    const idx = vocab.get(t);
    if (idx !== undefined) vec[idx] += 1;
  }
  return vec;
}

/** Cosine similarity between two Float32Array vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Build a simple BoW index for a prepared corpus. */
export function buildBoWIndex(corpus: PrepareResult, opts?: RetrieveOptions): BoWIndex {
  const vocab = buildVocabFromChunks(corpus.chunks, opts);
  const chunkVectors = corpus.chunks.map(c => vectorise(tokenise(c.text, opts), vocab));
  return { docId: corpus.docId, vocab, chunkVectors, chunks: corpus.chunks };
}

/** Retrieve the top chunk for a question against an existing BoW index. */
export function retrieveTop(question: string, index: BoWIndex, opts?: RetrieveOptions): RetrieveResult {
  const qVec = vectorise(tokenise(question, opts), index.vocab);
  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < index.chunkVectors.length; i++) {
    const s = cosine(qVec, index.chunkVectors[i]);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }

  const top = index.chunks[bestIdx];
  const sentence_ids: number[] = [];
  for (let s = top.startSentence; s < top.endSentence; s++) sentence_ids.push(s);

  return {
    chunk_index: bestIdx,
    chunk: top.text,
    sentence_ids,
    score: bestScore,
    cosine_score: bestScore,
  };
}

/** Convenience: index + retrieve in one call. */
export function retrieveFromPrepared(
  question: string,
  corpus: PrepareResult,
  opts?: RetrieveOptions
): RetrieveResult {
  const index = buildBoWIndex(corpus, opts);
  return retrieveTop(question, index, opts);
}

