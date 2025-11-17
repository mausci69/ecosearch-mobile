// apps/mobile/src/lib/agentic.ts
// British English comments.
// Tiny helpers so the UI can display consistent agentic hints.

import type { QueryResponse, AnswerFromChunkResponse } from "./api";

/** Returns true when app is running in offline mode. */
export function isOffline(): boolean {
  return process.env.EXPO_PUBLIC_OFFLINE === "1";
}

/** Decide if a retrieved result should be flagged as low confidence. */
export function isLowConfidence(res: Pick<QueryResponse, "low_confidence" | "cosine_score">): boolean {
  if (typeof res.low_confidence === "boolean") return res.low_confidence;
  return (res.cosine_score ?? 0) < 0.08; // same threshold used in api.ts
}

/** Pick the i18n key for the low-confidence hint. */
export function lowConfidenceI18nKey(): string {
  return "ask.lowConfidence";
}

/** Pick the i18n key for the offline answer note. */
export function offlineAnswerI18nKey(): string {
  return "ask.offlineAnswer";
}

/** Minimal reducer to a single display note for offline local answers. */
export function answerDisplayNote(ans: AnswerFromChunkResponse): string | undefined {
  return ans?.note;
}

