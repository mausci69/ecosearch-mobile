// /New_EcoSearch/EcoSearch_v1_mobile_llm/apps/mobile/src/local/retrieval.ts

// Local semantic-anchor retrieval for v1-shaped prepared corpora.
// Retrieval path:
// user query -> query embedding -> guiding question embeddings -> semantic score
// plus lexical anchor evidence:
// 1. exact anchors, e.g. MS, BASEBALL, LUNAR, GPT-4, 1130
// 2. rare lowercase keyword evidence, e.g. cytomegalovirus
//
// Final score:
// finalScore = semanticWeight * semanticScore + anchorWeight * anchorScore
// anchorWeight = 1 - semanticWeight
//
// The answer_focus field is no longer used for ranking or lexical matching.
// It is kept only as an empty compatibility field until the UI is cleaned up.

import type { PrepareResult, Chunk } from "./prepareCorpus";
import { loadOpenAIKey } from "./openaiKeyStore";

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_EMBEDDING_MODEL =
  process.env.EXPO_PUBLIC_OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

const DEFAULT_MIN_EXACT_ANCHOR_LENGTH = 2;
const DEFAULT_MIN_SOFT_KEYWORD_LENGTH = 4;
const SOFT_KEYWORD_MAX_DF_RATIO = 0.2;

const TOP_K_FOR_MERGE = 5;
const DEFAULT_RETRIEVE_K = 5;
const MAX_MERGED_SENTENCES = 10;
const MAX_SENTENCE_GAP_FOR_MERGE = 4;
const MIN_SHARED_STRONG_ANCHORS_FOR_MERGE = 2;
const MIN_SCORE_RATIO_FOR_MERGE = 0.82;

const DEFAULT_SEMANTIC_WEIGHT = 0.65;
const MIN_SEMANTIC_WEIGHT = 0.4;
const MAX_SEMANTIC_WEIGHT = 1.0;

const EXACT_ANCHOR_COMPONENT_WEIGHT = 2 / 3;
const SOFT_KEYWORD_COMPONENT_WEIGHT = 1 / 3;

export type SemanticIndex = {
  docId: string;
  chunks: Chunk[];
  sentences?: Array<{ id: number; text: string }>;
};

export type RetrieveOptions = {
  semanticWeight?: number;
  minTokenLength?: number;
  stopwords?: Set<string>;
};

export type RetrieveResult = {
  chunk_index: number;
  guiding_question: string;
  answer_focus: string;
  chunk: string;
  summary: string;
  sentence_ids: number[];
  score: number;
  cosine_score: number;
};

type RankedChunk = {
  idx: number;
  chunk: Chunk;
  sentenceIds: number[];
  score: number;
  semanticScore: number;
  anchorScore: number;
  exactAnchorScore: number;
  softKeywordScore: number;
  strongAnchors: Set<string>;
};

type RankingContext = {
  queryKeywords: string[];
  rareQueryKeywords: string[];
  keywordDf: Map<string, number>;
};

async function getOpenAIKey(): Promise<string> {
  const key = await loadOpenAIKey();

  if (!key) {
    throw new Error(
      "Missing OpenAI API key. Add your key in Manage corpus before asking questions."
    );
  }

  return key;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedText(text: string): Promise<number[]> {
  const cleanText = String(text || "").trim();

  if (!cleanText) return [];

  const apiKey = await getOpenAIKey();
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: cleanText,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(
          `OpenAI query embedding failed: HTTP ${res.status} ${errText}`
        );
      }

      const payload = await res.json();
      const embedding = payload?.data?.[0]?.embedding;

      if (!Array.isArray(embedding)) {
        throw new Error(
          "OpenAI query embedding failed: missing embedding vector."
        );
      }

      return embedding
        .map((x: any) => Number(x))
        .filter((x: number) => Number.isFinite(x));
    } catch (error) {
      lastError = error;

      if (attempt < 2) {
        await sleep(650);
      }
    }
  }

  throw lastError instanceof Error
    ? new Error(
        `Temporary network issue while creating query embedding. ${lastError.message}`
      )
    : new Error("Temporary network issue while creating query embedding.");
}

export function cosineArray(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);

  if (n === 0) return 0;

  let dot = 0;
  let na = 0;
  let nb = 0;

  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];

    dot += x * y;
    na += x * x;
    nb += y * y;
  }

  if (na === 0 || nb === 0) return 0;

  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function getSemanticWeight(options?: RetrieveOptions): number {
  const rawWeight = Number(options?.semanticWeight);

  if (!Number.isFinite(rawWeight)) {
    return DEFAULT_SEMANTIC_WEIGHT;
  }

  return Math.min(Math.max(rawWeight, MIN_SEMANTIC_WEIGHT), MAX_SEMANTIC_WEIGHT);
}

function semanticScore(queryEmbedding: number[], chunk: Chunk): number {
  const guidingQuestionEmbedding = Array.isArray(
    chunk.guiding_question_embedding
  )
    ? chunk.guiding_question_embedding
    : [];

  return clamp01(cosineArray(queryEmbedding, guidingQuestionEmbedding));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getSentenceIds(chunk: Chunk): number[] {
  return Array.isArray(chunk.sentence_ids)
    ? chunk.sentence_ids.map((x) => Number(x)).filter((x) => !Number.isNaN(x))
    : [];
}

function searchableChunkText(chunk: Chunk): string {
  return [chunk.guiding_question, chunk.summary, chunk.text]
    .map((x) => String(x || ""))
    .join("\n");
}

function tokenizeWords(text: string): string[] {
  return (
    String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []
  );
}

function extractExactAnchorTokens(
  text: string,
  options?: RetrieveOptions
): string[] {
  const minTokenLength =
    options?.minTokenLength ?? DEFAULT_MIN_EXACT_ANCHOR_LENGTH;
  const stopwords = options?.stopwords ?? new Set<string>();
  const unique = new Set<string>();

  for (const token of tokenizeWords(text)) {
    if (token.length < minTokenLength) continue;
    if (stopwords.has(token.toLocaleLowerCase())) continue;

    const isUppercaseAnchor =
      /[A-Z]/.test(token) && token === token.toUpperCase();
    const hasDigit = /\d/.test(token);
    const hasSymbol = /[_-]/.test(token);

    if (!isUppercaseAnchor && !hasDigit && !hasSymbol) continue;

    unique.add(token);
  }

  return Array.from(unique);
}

function extractSoftKeywords(
  text: string,
  options?: RetrieveOptions
): string[] {
  const minTokenLength =
    options?.minTokenLength ?? DEFAULT_MIN_SOFT_KEYWORD_LENGTH;
  const stopwords = options?.stopwords ?? new Set<string>();
  const unique = new Set<string>();

  for (const rawToken of tokenizeWords(text)) {
    const token = rawToken.toLocaleLowerCase();

    if (token.length < minTokenLength) continue;
    if (stopwords.has(token)) continue;

    unique.add(token);
  }

  return Array.from(unique);
}

function buildSoftKeywordDocumentFrequency(
  queryKeywords: string[],
  chunks: Chunk[]
): Map<string, number> {
  const df = new Map<string, number>();

  for (const keyword of queryKeywords) {
    df.set(keyword, 0);
  }

  for (const chunk of chunks) {
    const chunkKeywords = new Set(extractSoftKeywords(searchableChunkText(chunk)));

    for (const keyword of df.keys()) {
      if (chunkKeywords.has(keyword)) {
        df.set(keyword, (df.get(keyword) ?? 0) + 1);
      }
    }
  }

  return df;
}

function filterRareQueryKeywords(
  queryKeywords: string[],
  df: Map<string, number>,
  chunkCount: number
): string[] {
  const maxDf = Math.max(1, Math.ceil(chunkCount * SOFT_KEYWORD_MAX_DF_RATIO));

  return queryKeywords.filter((keyword) => {
    const count = df.get(keyword) ?? 0;
    return count > 0 && count <= maxDf;
  });
}

function extractStrongCorpusAnchors(chunk: Chunk): Set<string> {
  return new Set(extractExactAnchorTokens(searchableChunkText(chunk)));
}

function countExactTokenMatches(text: string, token: string): number {
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_-])${escapeRegExp(token)}(?=$|[^A-Za-z0-9_-])`,
    "g"
  );

  return String(text || "").match(pattern)?.length ?? 0;
}

function exactAnchorScore(
  question: string,
  chunk: Chunk,
  options?: RetrieveOptions
): number {
  const anchors = extractExactAnchorTokens(question, options);

  if (anchors.length === 0) return 0;

  const searchableText = searchableChunkText(chunk);

  let matchedAnchors = 0;
  let totalMatches = 0;

  for (const anchor of anchors) {
    const matches = countExactTokenMatches(searchableText, anchor);

    if (matches > 0) {
      matchedAnchors += 1;
      totalMatches += matches;
    }
  }

  if (matchedAnchors === 0) return 0;

  const coverage = matchedAnchors / anchors.length;
  const repetition = Math.min(totalMatches, 3) / 3;

  return clamp01(coverage * 0.8 + repetition * 0.2);
}

function softKeywordScore(chunk: Chunk, rareQueryKeywords: string[]): number {
  if (rareQueryKeywords.length === 0) return 0;

  const chunkKeywords = new Set(extractSoftKeywords(searchableChunkText(chunk)));

  let matched = 0;

  for (const keyword of rareQueryKeywords) {
    if (chunkKeywords.has(keyword)) matched += 1;
  }

  if (matched === 0) return 0;

  return clamp01(matched / rareQueryKeywords.length);
}

function anchorScore(
  exactScore: number,
  softScore: number
): number {
  return clamp01(
    EXACT_ANCHOR_COMPONENT_WEIGHT * exactScore +
      SOFT_KEYWORD_COMPONENT_WEIGHT * softScore
  );
}

function countSharedAnchors(a: Set<string>, b: Set<string>): number {
  let shared = 0;

  for (const token of a) {
    if (b.has(token)) shared += 1;
  }

  return shared;
}

function getSentenceGap(a: number[], b: number[]): number {
  if (!a.length || !b.length) return Number.POSITIVE_INFINITY;

  const aMin = Math.min(...a);
  const aMax = Math.max(...a);
  const bMin = Math.min(...b);
  const bMax = Math.max(...b);

  if (aMax >= bMin && bMax >= aMin) return 0;

  if (aMax < bMin) return bMin - aMax - 1;

  return aMin - bMax - 1;
}

function buildMergedSentenceIds(chunks: RankedChunk[]): number[] {
  const allIds = chunks.flatMap((item) => item.sentenceIds);

  if (!allIds.length) return [];

  const minId = Math.min(...allIds);
  const maxId = Math.max(...allIds);
  const count = maxId - minId + 1;

  if (count > MAX_MERGED_SENTENCES) {
    return Array.from(new Set(allIds)).sort((a, b) => a - b);
  }

  return Array.from({ length: count }, (_, offset) => minId + offset);
}

function buildMergedText(
  index: SemanticIndex,
  selectedChunks: RankedChunk[],
  fallbackChunk: Chunk
): string {
  const mergedSentenceIds = buildMergedSentenceIds(selectedChunks);

  if (index.sentences?.length && mergedSentenceIds.length) {
    const byId = new Map<number, string>();

    for (const sentence of index.sentences) {
      byId.set(Number(sentence.id), String(sentence.text || "").trim());
    }

    const text = mergedSentenceIds
      .map((id) => byId.get(id))
      .filter((sentence): sentence is string => !!sentence)
      .join(" ")
      .trim();

    if (text) return text;
  }

  return String(fallbackChunk.text || "");
}

function selectNeighbourMergeCandidates(ranked: RankedChunk[]): RankedChunk[] {
  const top = ranked[0];

  if (!top) return [];

  const selected = [top];

  for (const candidate of ranked.slice(1)) {
    const gap = getSentenceGap(top.sentenceIds, candidate.sentenceIds);
    const sharedAnchors = countSharedAnchors(
      top.strongAnchors,
      candidate.strongAnchors
    );

    const closeEnough = gap <= MAX_SENTENCE_GAP_FOR_MERGE;
    const anchorRelated = sharedAnchors >= MIN_SHARED_STRONG_ANCHORS_FOR_MERGE;
    const scoreCloseEnough =
      top.score <= 0 || candidate.score >= top.score * MIN_SCORE_RATIO_FOR_MERGE;

    if (closeEnough && anchorRelated && scoreCloseEnough) {
      selected.push(candidate);
    }
  }

  return selected.sort((a, b) => {
    const aMin = a.sentenceIds.length ? Math.min(...a.sentenceIds) : a.idx;
    const bMin = b.sentenceIds.length ? Math.min(...b.sentenceIds) : b.idx;

    return aMin - bMin;
  });
}

function emptyRetrieveResult(): RetrieveResult {
  return {
    chunk_index: -1,
    guiding_question: "",
    answer_focus: "",
    chunk: "",
    summary: "",
    sentence_ids: [],
    score: 0,
    cosine_score: 0,
  };
}

function rankedChunkToResult(item: RankedChunk, chunkText?: string): RetrieveResult {
  const safeScore = Math.min(Math.max(item.score, 0), 0.999);
  const safeSemanticScore = Math.min(Math.max(item.semanticScore, 0), 0.999);

  return {
    chunk_index: item.idx,
    guiding_question: String(item.chunk.guiding_question || "").trim(),
    answer_focus: "",
    chunk: String(chunkText ?? item.chunk.text ?? ""),
    summary: String(item.chunk.summary || "").trim(),
    sentence_ids: item.sentenceIds,
    score: safeScore,
    cosine_score: safeSemanticScore,
  };
}

function buildRankingContext(
  question: string,
  chunks: Chunk[],
  options?: RetrieveOptions
): RankingContext {
  const queryKeywords = extractSoftKeywords(question, options);
  const keywordDf = buildSoftKeywordDocumentFrequency(queryKeywords, chunks);
  const rareQueryKeywords = filterRareQueryKeywords(
    queryKeywords,
    keywordDf,
    chunks.length
  );

  return {
    queryKeywords,
    rareQueryKeywords,
    keywordDf,
  };
}

function logRankingContext(context: RankingContext): void {
  console.log(
    "[SEMANTIC ANCHOR QUERY KEYWORDS]",
    JSON.stringify(
      {
        queryKeywords: context.queryKeywords,
        rareQueryKeywords: context.rareQueryKeywords,
        keywordDf: Object.fromEntries(context.keywordDf.entries()),
      },
      null,
      2
    )
  );
}

function rankChunks(
  question: string,
  queryEmbedding: number[],
  index: SemanticIndex,
  context: RankingContext,
  options?: RetrieveOptions
): RankedChunk[] {
  const semanticWeight = getSemanticWeight(options);
  const anchorWeight = 1 - semanticWeight;

  return index.chunks
    .map((chunk, idx): RankedChunk => {
      const semantic = semanticScore(queryEmbedding, chunk);
      const exact = exactAnchorScore(question, chunk, options);
      const soft = softKeywordScore(chunk, context.rareQueryKeywords);
      const anchor = anchorScore(exact, soft);
      const score = semanticWeight * semantic + anchorWeight * anchor;

      return {
        idx,
        chunk,
        sentenceIds: getSentenceIds(chunk),
        score,
        semanticScore: semantic,
        anchorScore: anchor,
        exactAnchorScore: exact,
        softKeywordScore: soft,
        strongAnchors: extractStrongCorpusAnchors(chunk),
      };
    })
    .sort((a, b) => b.score - a.score);
}

function logTopCandidates(ranked: RankedChunk[], limit: number): void {
  const topItems = ranked.slice(0, limit);

  console.log(
    "[SEMANTIC ANCHOR RETRIEVE TOP 5]",
    JSON.stringify(
      topItems.map((item) => ({
        idx: item.idx,
        score: item.score,
        semanticScore: item.semanticScore,
        anchorScore: item.anchorScore,
        exactAnchorScore: item.exactAnchorScore,
        softKeywordScore: item.softKeywordScore,
        sentenceIds: item.sentenceIds,
        strongAnchors: Array.from(item.strongAnchors),
        guidingQuestion: String(item.chunk.guiding_question || "").slice(0, 180),
        summary: String(item.chunk.summary || "").slice(0, 180),
        chunkText: String(item.chunk.text || "").slice(0, 180),
        hasGuidingQuestionEmbedding: Array.isArray(
          item.chunk.guiding_question_embedding
        )
          ? item.chunk.guiding_question_embedding.length > 0
          : false,
      })),
      null,
      2
    )
  );
}

export function buildSemanticIndex(corpus: PrepareResult): SemanticIndex {
  return {
    docId: corpus.docId,
    chunks: corpus.chunks,
    sentences: Array.isArray((corpus as any).sentences)
      ? (corpus as any).sentences
      : undefined,
  };
}

export async function retrieveTopK(
  question: string,
  index: SemanticIndex,
  k = DEFAULT_RETRIEVE_K,
  options?: RetrieveOptions
): Promise<RetrieveResult[]> {
  const queryEmbedding = await embedText(question);
  const context = buildRankingContext(question, index.chunks, options);

  logRankingContext(context);

  const ranked = rankChunks(question, queryEmbedding, index, context, options);
  const safeK = Math.max(1, k);

  logTopCandidates(ranked, Math.max(TOP_K_FOR_MERGE, safeK));

  return ranked.slice(0, safeK).map((item) => rankedChunkToResult(item));
}

export async function retrieveTop(
  question: string,
  index: SemanticIndex,
  options?: RetrieveOptions
): Promise<RetrieveResult> {
  const queryEmbedding = await embedText(question);
  const context = buildRankingContext(question, index.chunks, options);

  logRankingContext(context);

  const ranked = rankChunks(question, queryEmbedding, index, context, options);
  const topFive = ranked.slice(0, TOP_K_FOR_MERGE);

  logTopCandidates(ranked, TOP_K_FOR_MERGE);

  const top = topFive[0];

  if (!top) {
    return emptyRetrieveResult();
  }

  const mergeCandidates = selectNeighbourMergeCandidates(topFive);
  const mergedSentenceIds = buildMergedSentenceIds(mergeCandidates);
  const mergedText = buildMergedText(index, mergeCandidates, top.chunk);

  const safeScore = Math.min(Math.max(top.score, 0), 0.999);
  const safeSemanticScore = Math.min(Math.max(top.semanticScore, 0), 0.999);

  console.log("[SEMANTIC ANCHOR RETRIEVE RAW SCORE]", top.score, "=>", safeScore);
  console.log(
    "[SEMANTIC ANCHOR RETRIEVE RAW SEMANTIC]",
    top.semanticScore,
    "=>",
    safeSemanticScore
  );
  console.log(
    "[SEMANTIC ANCHOR RETRIEVE MERGE]",
    JSON.stringify(
      {
        topIdx: top.idx,
        mergedIdxs: mergeCandidates.map((item) => item.idx),
        mergedSentenceIds,
      },
      null,
      2
    )
  );

  return {
    ...rankedChunkToResult(top, mergedText),
    sentence_ids: mergedSentenceIds.length ? mergedSentenceIds : top.sentenceIds,
  };
}

export async function retrieveFromPrepared(
  question: string,
  corpus: PrepareResult,
  options?: RetrieveOptions
): Promise<RetrieveResult> {
  const index = buildSemanticIndex(corpus);
  return retrieveTop(question, index, options);
}

export async function retrieveCandidatesFromPrepared(
  question: string,
  corpus: PrepareResult,
  k = DEFAULT_RETRIEVE_K,
  options?: RetrieveOptions
): Promise<RetrieveResult[]> {
  const index = buildSemanticIndex(corpus);
  return retrieveTopK(question, index, k, options);
}