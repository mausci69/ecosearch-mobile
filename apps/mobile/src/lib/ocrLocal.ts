import TextRecognition from "@react-native-ml-kit/text-recognition";

/** Result per page when running on-device OCR. */
export type LocalOcrPageResult = {
  ok: true;
  text: string;
} | {
  ok: false;
  text: "";
  error: string;
};

export type LocalOcrBatchResult = {
  text: string;                // concatenated text (pages joined with \n\n)
  pages: LocalOcrPageResult[]; // per-page outcomes
};

/**
 * Run ML Kit OCR over multiple image URIs (offline).
 * @param uris Array of file:// or content:// image URIs
 * @param lang Optional UI language hint ("en" | "it"); ML Kit is language-agnostic here
 */
export async function mlkitExtractPages(
  uris: string[],
  lang?: "en" | "it"
): Promise<LocalOcrBatchResult> {
  const pages: LocalOcrPageResult[] = [];
  for (const uri of uris) {
    try {
      const res = await TextRecognition.recognize(uri);
      const pageText = res?.text?.trim?.() ?? "";
      pages.push({ ok: true, text: pageText });
    } catch (e: any) {
      pages.push({ ok: false, text: "", error: e?.message ?? "OCR failed" });
    }
  }
  const text = pages.map(p => p.ok ? p.text : "").filter(Boolean).join("\n\n");
  return { text, pages };
}

