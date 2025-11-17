import { postFormData, postJSON, getJSON, apiUrl } from "./client";
import { prepareCorpusLocal } from "../local/prepareCorpus";
import { loadActiveCorpus } from "../local/corpusStore";
import { retrieveFromPrepared } from "../local/retrieval";
import { generateAnswerFromChunk } from "../local/localGen";

// Types

export type OCRResponse = {
  text: string;
  lang_used?: string;
  error?: string;
};

export type QueryResponse = {
  question: string;
  guiding_question: string;
  chunk: string;
  summary: string;
  score: number;
  cosine_score: number;
  sentence_ids: number[];
  chunk_index: number;
  low_confidence?: boolean;
  error?: string;
  ready?: boolean; // backend: true when corpus is usable, false when not prepared
};

export type FallbackResponse = {
  chunk: string;
  score: number;
  start_idx: number;
  error?: string;
};

export type AnswerFromChunkResponse = {
  answer: string;
  note?: string;
  fallback_chunk?: string;
  similarity?: number;
  error?: string;
};

export type HealthResponse = {
  status: "ok";
  llm_enabled: boolean;
  ocr_lang: string;
  ocr_ready: boolean;
};

export type OCRPagesResponse = {
  text: string;
  pages: string[];
  page_count: number;
  lang_used: string;
};

// === OCR endpoints ===

export async function ocrExtract(
  form: FormData,
  optsOrReturnPdf?: boolean | { lang?: string; returnPdf?: boolean }
): Promise<Blob | any> {
  const returnPdf =
    typeof optsOrReturnPdf === "boolean"
      ? optsOrReturnPdf
      : !!optsOrReturnPdf?.returnPdf;
  const lang =
    typeof optsOrReturnPdf === "object" ? optsOrReturnPdf?.lang : undefined;

  const qs = new URLSearchParams({ return_pdf: returnPdf ? "true" : "false" });
  if (lang) qs.set("lang", lang);

  const path = `/ocr_extract?${qs.toString()}`;
  // The client auto-detects PDF vs JSON by Content-Type header
  return await postFormData<any>(path, form);
}

export async function ocrExtractPages(
  form: FormData,
  opts?: { lang?: string; returnPdf?: boolean }
): Promise<OCRPagesResponse> {
  const qs = new URLSearchParams();
  if (opts?.lang) qs.set("lang", opts.lang);
  if (opts?.returnPdf) qs.set("return_pdf", "true");
  const path = `/ocr_extract_pages${qs.toString() ? `?${qs.toString()}` : ""}`;
  return await postFormData<OCRPagesResponse>(path, form);
}

/**
 * Routed multi-page OCR with optional local engine, then server.
 */
export async function ocrExtractPagesSmart(
  images: { uri: string; name?: string }[],
  serverForm: FormData,
  opts?: { lang?: "en" | "it"; returnPdf?: boolean }
): Promise<OCRPagesResponse & { engine: "mlkit" | "server" }> {
  try {
    const { getOcrEngine } = await import("../utils/storage");
    const engine = await getOcrEngine();
    if (engine === "mlkit") {
      try {
        const { mlkitExtractPages } = await import("./ocrLocal");
        const res = await mlkitExtractPages(
          images.map((i) => i.uri),
          opts?.lang as any
        );
        const text = (res?.text ?? "").trim();
        if (text.length > 0) {
          return {
            text,
            pages: res.pages.map((p: any) => (p.ok ? p.text : "")),
            page_count: images.length,
            lang_used: (opts?.lang as any) || "en",
            engine: "mlkit",
          };
        }
      } catch {
        // fall through to server
      }
    }
  } catch {
    // fall through to server
  }

  const server = await ocrExtractPages(serverForm, opts);
  return { ...server, engine: "server" };
}

// === Query endpoints ===

export async function query(question: string): Promise<QueryResponse> {
  const q = (question || "").trim();

  // Offline retrieval path (EXPO_PUBLIC_OFFLINE hard switch)
  if (process.env.EXPO_PUBLIC_OFFLINE === "1") {
    const corpus = await loadActiveCorpus();
    if (!corpus) {
      return {
        question: q,
        guiding_question: "",
        chunk: "",
        summary: "",
        score: 0,
        cosine_score: 0,
        sentence_ids: [],
        chunk_index: -1,
        error: "No active corpus",
        ready: false,
      };
    }

    const res = retrieveFromPrepared(q, corpus);
    const low = typeof res.cosine_score === "number" && res.cosine_score < 0.08;

    return {
      question: q,
      guiding_question: q,
      chunk: res.chunk,
      summary: "",
      score: res.score,
      cosine_score: res.cosine_score,
      sentence_ids: res.sentence_ids,
      chunk_index: res.chunk_index,
      low_confidence: low,
      ready: true,
    };
  }

  // Online path (backend /query)
  const raw = await postJSON<any>("/query", { question: q });

  // If backend explicitly reports corpus not ready
  if (raw && raw.ready === false) {
    return {
      question: q,
      guiding_question: "",
      chunk: "",
      summary: "",
      score: 0,
      cosine_score: 0,
      sentence_ids: [],
      chunk_index: -1,
      low_confidence: true,
      error: raw.error ? String(raw.error) : "Corpus not ready",
      ready: false,
    };
  }

  const cos =
    typeof raw?.cosine_score === "string"
      ? parseFloat(raw.cosine_score)
      : typeof raw?.cosine_score === "number"
      ? raw.cosine_score
      : 0;

  const score =
    typeof raw?.score === "string"
      ? parseFloat(raw.score)
      : typeof raw?.score === "number"
      ? raw.score
      : 0;

  const sentence_ids = Array.isArray(raw?.sentence_ids)
    ? raw.sentence_ids.map((x: any) => Number(x)).filter((x: any) => !Number.isNaN(x))
    : [];

  const chunk_index =
    typeof raw?.chunk_index === "string"
      ? parseInt(raw.chunk_index, 10)
      : typeof raw?.chunk_index === "number"
      ? raw.chunk_index
      : -1;

  const out: QueryResponse = {
    question: String(raw?.question ?? q),
    guiding_question: String(raw?.guiding_question ?? ""),
    chunk: String(raw?.chunk ?? ""),
    summary: String(raw?.summary ?? ""),
    score,
    cosine_score: cos,
    sentence_ids,
    chunk_index,
    low_confidence: raw?.low_confidence === true,
    error: raw?.error ? String(raw.error) : undefined,
    ready: true,
  };

  return out;
}

export async function fallback(question: string): Promise<FallbackResponse> {
  return await postJSON("/fallback", { question });
}

export async function answerFromChunk(
  question: string,
  chunk: string
): Promise<AnswerFromChunkResponse> {
  const q = (question || "").trim();
  const c = String(chunk || "");

  if (!c) {
    return {
      answer: "",
      error: "Empty chunk",
    };
  }

  if (process.env.EXPO_PUBLIC_OFFLINE === "1") {
    const res = generateAnswerFromChunk(q, c);
    return {
      answer: res.answer,
      note: res.note,
      similarity: res.similarity,
    };
  }

  return await postJSON("/llm_answer_from_chunk", { question: q, chunk: c });
}

export async function answerFromFallbackChunk(
  question: string,
  chunk: string
): Promise<AnswerFromChunkResponse> {
  const q = (question || "").trim();
  const c = String(chunk || "");

  if (!c) {
    return {
      answer: "",
      error: "Empty chunk",
    };
  }

  return await postJSON("/llm_answer_from_fallback_chunk", {
    question: q,
    chunk: c,
  });
}

export async function health(): Promise<HealthResponse> {
  return await getJSON("/health");
}

// === Prepare corpus ===

export type PrepareCorpusResponse = {
  ready: boolean;
  status?: string;
  message?: string;
  chunks?: number;
  index_size?: number;
};

/**
 * Prepare corpus on server (or locally in offline mode).
 *
 * Backward compatible signature:
 *  - prepareCorpusFromText(text)
 *  - prepareCorpusFromText(text, timeoutMs)
 *  - prepareCorpusFromText(text, useRerank, timeoutMs)  // useRerank is ignored now
 */
export async function prepareCorpusFromText(
  text: string,
  useRerankOrTimeout: boolean | number = 300000,
  maybeTimeout?: number
): Promise<PrepareCorpusResponse> {
  const bodyText = (text || "").trim();
  let timeout = 300000;

  if (typeof useRerankOrTimeout === "number") {
    timeout = useRerankOrTimeout;
  } else if (typeof maybeTimeout === "number") {
    timeout = maybeTimeout;
  }

  if (!bodyText) {
    return {
      ready: false,
      status: "error",
      message: "Empty text. Provide non-empty text to prepare corpus.",
      chunks: 0,
      index_size: 0,
    };
  }

  // Offline mode: build corpus locally
  if (process.env.EXPO_PUBLIC_OFFLINE === "1") {
    const res = prepareCorpusLocal(bodyText);
    const { savePreparedCorpus } = await import("../local/corpusStore");
    await savePreparedCorpus(res, { setActive: true });
    return {
      ready: true,
      status: "ok-local",
      message: "Local corpus prepared.",
      chunks: res.chunks.length,
      index_size: res.chunks.length,
    };
  }

  // Server mode: call /prepare_corpus with the new contract
  const raw = await postJSON<any>(
    "/prepare_corpus",
    { text: bodyText },
    timeout
  );

  return {
    ready: !!raw?.ready,
    status: raw?.status,
    message: raw?.message,
    chunks:
      typeof raw?.chunks === "number" ? raw.chunks : undefined,
    index_size:
      typeof raw?.index_size === "number"
        ? raw.index_size
        : undefined,
  };
}

// Utility export
export { apiUrl };