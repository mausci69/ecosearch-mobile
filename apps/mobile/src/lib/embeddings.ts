// Local sentence embeddings via TFJS (React Native).
// v1 uses Universal Sentence Encoder (USE) with TFJS backend.
// Note: model is fetched at first use; we will optimise/bundle later.

import * as use from "@tensorflow-models/universal-sentence-encoder";
import type { UniversalSentenceEncoder } from "@tensorflow-models/universal-sentence-encoder";
import { initTF } from "./tfjs";

let model: UniversalSentenceEncoder | null = null;
let loading: Promise<void> | null = null;

/** Load the USE model exactly once. */
async function ensureModel(): Promise<void> {
  if (model) return;
  if (loading) return loading;
  loading = (async () => {
    await initTF(); // pick rn-webgl if available, else CPU
    model = await use.load();
  })();
  return loading;
}

/** Embed a single string into a float vector. */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embedMany([text]);
  return vec;
}

/** Embed multiple strings; returns plain JS arrays for easy storage/serialisation. */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  await ensureModel();
  const m = model!;
  const t = await m.embed(texts);
  const out: number[][] = Array(texts.length);
  const data = await t.data(); // flat Float32Array
  const dim = t.shape[1];
  for (let i = 0; i < texts.length; i++) {
    const start = i * dim;
    const slice = Array.from(data.slice(start, start + dim));
    out[i] = slice;
  }
  t.dispose();
  return out;
}

/** Small helper to clear the loaded model from memory (for testing). */
export function _resetEmbeddingsForTests() {
  model = null;
  loading = null;
}

