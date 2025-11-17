import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ImagePickerAsset } from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { getOcrLang, setOcrLang as setGlobalOcrLang } from "../../lib/lang";
import { ocrExtractPages, prepareCorpusFromText, health } from "../../lib/api";
import { pickImageAsset } from "./pickImage";
import { savePdfBlob } from "../../utils/savePdf";
import { setItemSafe } from "../../utils/storage";
import { generateAnswer } from "../../lib/generate";
import LocalStatusInline from "../../components/LocalStatusInline";

type Props = {
  styles: {
    cardLarge: any;
    sectionTitle: any;
    button: any;
    buttonDisabled: any;
    buttonText: any;
    muted: any;
  };
};

const OCR_CACHE_KEY = "@eco/scan_pages_state_v1";

const ocrStyles = StyleSheet.create({
  toggle: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1c6a52",
    backgroundColor: "#0f3f30",
  },
  toggleActive: {
    backgroundColor: "#1aa673",
  },
  toggleText: {
    fontWeight: "700",
    color: "#9fd7c6",
  },
  toggleTextActive: {
    color: "#07271d",
  },
  row: {
    flexDirection: "row",
    gap: 10,
    marginLeft: 8,
  },
});

/**
 * Multi-page scan widget:
 * - Seleziona/scatta più pagine
 * - Riordina, rimuovi, rifai l’ultima
 * - OCR multi-pagina
 * - Prepara corpus dal testo OCR e segna quando è pronto per le query
 */
export default function MultiPageScan({ styles }: Props) {
  const { t } = useTranslation();

  // Lingua OCR (single source of truth: lib/lang)
  const [ocrLang, setOcrLangState] = useState<"en" | "it">("en");

  // Pagine e testo combinato
  const [assets, setAssets] = useState<ImagePickerAsset[]>([]);
  const [combinedText, setCombinedText] = useState<string>("");

  // Stato corpus
  const [corpusReady, setCorpusReady] = useState<boolean>(false);
  const [prepBusy, setPrepBusy] = useState<boolean>(false);
  const [prepMsg, setPrepMsg] = useState<string>("");

  // Stato backend / OCR
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [backendStatus, setBackendStatus] = useState<string | null>(null);
  const [ocrDebug, setOcrDebug] = useState<{ langUsed?: string; pageCount?: number } | null>(null);

  // UI states
  const [busy, setBusy] = useState<boolean>(false);
  const [genBusy, setGenBusy] = useState<boolean>(false);
  const [localSummary, setLocalSummary] = useState<string | null>(null);
  const [localQuestions, setLocalQuestions] = useState<string | null>(null);
  const [pageReports, setPageReports] = useState<Array<{ index: number; text?: string; error?: string }> | null>(null);

  const anyBusy = busy || prepBusy || genBusy;

  // Inizializza lingua OCR dalla sorgente condivisa
  useEffect(() => {
    (async () => {
      try {
        const lang = (await getOcrLang()).slice(0, 2);
        setOcrLangState(lang === "it" ? "it" : "en");
      } catch {
        setOcrLangState("en");
      }
    })();
  }, []);

  // Ripristina stato scansioni (pagine + testo) se esiste cache recente
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(OCR_CACHE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        const maxAgeMs = 10 * 60 * 1000;
        if (!saved.ts || Date.now() - saved.ts > maxAgeMs) {
          await AsyncStorage.removeItem(OCR_CACHE_KEY);
          return;
        }
        if (Array.isArray(saved.assets)) {
          setAssets(saved.assets);
        }
        if (typeof saved.combinedText === "string") {
          setCombinedText(saved.combinedText);
        }
      } catch (e) {
        console.log("[MultiPageScan] restore failed", e);
      }
    })();
  }, []);

  // Persistenza breve per cambi tab/lingua
  useEffect(() => {
    (async () => {
      try {
        if (assets.length === 0 && !combinedText) {
          await AsyncStorage.removeItem(OCR_CACHE_KEY);
        } else {
          await AsyncStorage.setItem(
            OCR_CACHE_KEY,
            JSON.stringify({ assets, combinedText, ts: Date.now() })
          );
        }
      } catch (e) {
        console.log("[MultiPageScan] persist failed", e);
      }
    })();
  }, [assets, combinedText]);

  // Ping backend
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await health();
        if (!cancelled) {
          setBackendUp(h?.status === "ok");
          setBackendStatus(h?.status ?? null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setBackendUp(false);
          setBackendStatus(String(e?.message || "unreachable"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isDisabled = (needsAssets = false, needsText = false, needsBackend = false) => {
    if (anyBusy) return true;
    if (needsAssets && assets.length === 0) return true;
    if (needsText && !combinedText.trim()) return true;
    if (needsBackend && backendUp !== true) return true;
    return false;
  };

  async function maybeDownscaleAsset(asset: ImagePickerAsset): Promise<ImagePickerAsset> {
    try {
      const w = (asset as any)?.width as number | undefined;
      const h = (asset as any)?.height as number | undefined;
      const size = (asset as any)?.fileSize as number | undefined;

      const MAX_DIM = 2000;
      const COMPRESS = 0.8;

      let actions: ImageManipulator.Action[] = [];
      if (w && h) {
        const maxDim = Math.max(w, h);
        if (maxDim > MAX_DIM) {
          const scale = MAX_DIM / maxDim;
          actions.push({
            resize: { width: Math.round(w * scale), height: Math.round(h * scale) },
          });
        }
      }

      const result = await ImageManipulator.manipulateAsync(
        asset.uri,
        actions,
        { compress: COMPRESS, format: ImageManipulator.SaveFormat.JPEG }
      );

      return {
        ...asset,
        uri: result.uri,
        width: (result as any).width ?? w,
        height: (result as any).height ?? h,
        mimeType: "image/jpeg" as any,
        fileName: (asset as any).fileName ?? `page_${Date.now()}.jpg`,
        fileSize: size,
      } as ImagePickerAsset;
    } catch {
      return asset;
    }
  }

  const handleSetLang = async (lang: "en" | "it") => {
    if (anyBusy) return;
    setOcrLangState(lang);
    await setGlobalOcrLang(lang);
    setCorpusReady(false);
    setPrepMsg("");
  };

  const addFrom = async (source: "camera" | "library") => {
    try {
      const asset = await pickImageAsset(source);
      if (asset) {
        const processed = await maybeDownscaleAsset(asset);
        setAssets((prev) => [...prev, processed]);
        setCorpusReady(false);
        setPrepMsg("");
      }
    } catch (e: any) {
      Alert.alert(
        t(source === "camera" ? "scan.alert.cameraErrorTitle" : "scan.alert.galleryErrorTitle"),
        t(
          source === "camera" ? "scan.alert.cameraErrorBody" : "scan.alert.galleryErrorBody",
          { detail: String(e?.message ?? "") }
        )
      );
    }
  };

  const removeAt = (idx: number) => {
    setAssets((prev) => prev.filter((_, i) => i !== idx));
    setCorpusReady(false);
    setPrepMsg("");
  };

  const move = (from: number, to: number) => {
    setAssets((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const copy = prev.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    setCorpusReady(false);
    setPrepMsg("");
  };

  const retakeLast = async () => {
    if (!assets.length) return;
    try {
      const repl = await pickImageAsset("camera");
      if (!repl) return;
      const processed = await maybeDownscaleAsset(repl);
      setAssets((prev) => {
        const copy = prev.slice();
        copy[copy.length - 1] = processed;
        return copy;
      });
      setCorpusReady(false);
      setPrepMsg("");
    } catch (e: any) {
      Alert.alert(
        t("scan.alert.cameraErrorTitle"),
        t("scan.alert.cameraErrorBody", { detail: String(e?.message ?? "") })
      );
    }
  };

  const buildFilesForm = () => {
    const form = new FormData();
    assets.forEach((a, i) => {
      form.append("files", {
        // @ts-expect-error React Native file part
        uri: a.uri,
        name: a.fileName || `page_${i + 1}.jpg`,
        type: (a as any).mimeType || "image/jpeg",
      });
    });
    return form;
  };

  const onAssemble = async () => {
    if (!assets.length) return;
    try {
      setBusy(true);
      const form = buildFilesForm();
      const lang = ocrLang === "en" ? "eng" : "ita";
      const res: any = await ocrExtractPages(form, { lang, assemble_pdf: true });
      if (!res?.pdf_bytes) throw new Error("No PDF returned");
      const uri = await savePdfBlob(res.pdf_bytes, `ocr_${Date.now()}.pdf`, true);
      Alert.alert(
        t("scan.alert.pdfSavedTitle", "PDF saved"),
        t("scan.alert.pdfSavedBody", { uri })
      );
      setAssets([]);
      setCombinedText("");
      setCorpusReady(false);
      setPrepMsg("");
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      const detail =
        e?.body?.detail ??
        e?.response?.data?.detail ??
        e?.message ??
        e;

      let hint = "";
      if (status === 413) {
        hint = "\n" + t("scan.hints.tooLarge", "Hint: images are too large. Try fewer pages or lower resolution.");
      } else if (status === 415) {
        hint = "\n" + t("scan.hints.unsupportedType", "Hint: unsupported file type. Use JPEG/PNG photos.");
      } else if (status === 400) {
        hint = "\n" + t("scan.hints.requestInvalid", "Hint: request invalid. Reorder pages or retake a blurry photo.");
      }

      Alert.alert(
        t("scan.alert.assembleFailedTitle", "Assemble failed") + (status ? ` (HTTP ${status})` : ""),
        `${String(detail)}${hint}`
      );
    } finally {
      setBusy(false);
    }
  };

  const onExtractText = async () => {
    if (!assets.length) return;
    try {
      setBusy(true);

      const h = await health();
      if (!h || h.status !== "ok") {
        setBusy(false);
        Alert.alert(
          t("scan.backend.unreachableTitle", "Server not reachable"),
          t("scan.backend.unreachableBody", "Check that the EcoSearch backend is running and your device is on the same Wi-Fi.")
        );
        return;
      }

      const form = buildFilesForm();
      const lang = ocrLang === "en" ? "eng" : "ita";
      const res: any = await ocrExtractPages(form, { lang });

      if (typeof __DEV__ !== "undefined" && __DEV__) {
        console.log("[OCR] pages extracted", {
          langSent: lang,
          langUsed: res?.lang_used,
          pageCount: res?.page_count,
        });
        setOcrDebug({ langUsed: res?.lang_used, pageCount: res?.page_count });
      }

      setCombinedText(res.text || "");
      setPageReports(Array.isArray(res.pages) ? res.pages.map((text: string, index: number) => ({
        index,
        text,
        error: text ? undefined : "Empty OCR result",
      })) : null);
      setCorpusReady(false);
      setPrepMsg("");
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      const detail =
        e?.body?.detail ??
        e?.response?.data?.detail ??
        e?.message ??
        e;

      let hint = "";
      if (status === 413) {
        hint = "\n" + t("scan.hints.tooLarge", "Hint: images are too large. Try fewer pages or lower resolution.");
      } else if (status === 415) {
        hint = "\n" + t("scan.hints.unsupportedType", "Hint: unsupported file type. Use JPEG/PNG photos.");
      } else if (status === 400) {
        hint = "\n" + t("scan.hints.requestInvalid", "Hint: request invalid. Reorder pages or retake a blurry photo.");
      }

      Alert.alert(
        t("scan.alert.extractFailedTitle", "Extract failed") + (status ? ` (HTTP ${status})` : ""),
        `${String(detail)}${hint}`
      );
    } finally {
      setBusy(false);
    }
  };

  const onPrepareFromText = async () => {
    const textTrimmed = (combinedText || "").trim();
    if (!textTrimmed) {
      Alert.alert(
        t("prepare.tooShortTitle", "Text too short"),
        t("prepare.tooShortBody", "Please run OCR or paste some text before preparing the corpus.")
      );
      return;
    }
    try {
      setPrepBusy(true);
      setPrepMsg("");
      setCorpusReady(false);

      const res: any = await prepareCorpusFromText(textTrimmed);

      if (res && res.ready) {
        setCorpusReady(true);
        setPrepMsg(res.message || t("prepare.ready", "Ready to ask"));
      } else {
        setCorpusReady(false);
        const msg =
          (res && (res.message || res.status)) ||
          t("prepare.failedGeneric", "Could not prepare corpus. Please try again.");
        setPrepMsg(msg);
      }
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      const detail =
        e?.body?.detail ??
        e?.response?.data?.detail ??
        e?.message ??
        e;

      let suffix = "";
      if (status === 413) {
        suffix = " " + t("scan.hints.tooLarge", "Hint: text is too large.");
      } else if (status === 400) {
        suffix = " " + t("scan.hints.requestInvalid", "Hint: request invalid.");
      }

      const msg = `Prepare failed${status ? ` (HTTP ${status})` : ""}: ${String(detail)}${suffix}`;
      setPrepMsg(msg);
      setCorpusReady(false);
    } finally {
      setPrepBusy(false);
    }
  };

  const onClear = () => {
    Alert.alert(
      t("scan.clearConfirmTitle", "Clear all pages?"),
      t("scan.clearConfirmBody", "This will remove queued pages, extracted text, and corpus ready state."),
      [
        { text: t("common.cancel", "Cancel"), style: "cancel" },
        {
          text: t("common.clear", "Clear"),
          style: "destructive",
          onPress: () => {
            setAssets([]);
            setCombinedText("");
            setPrepMsg("");
            setPrepBusy(false);
            setPageReports(null);
            setLocalSummary(null);
            setLocalQuestions(null);
            setGenBusy(false);
            setCorpusReady(false);
          },
        },
      ]
    );
  };

  const onGenSummary = async () => {
    const text = (combinedText || "").trim();
    if (!text) {
      Alert.alert(
        t("ocr.offline.noTextAlertTitle", "No text"),
        t("ocr.offline.noTextAlertBody", "Run OCR before generating a summary.")
      );
      return;
    }
    try {
      setGenBusy(true);
      const res = await generateAnswer(
        `Summarise the following text in 4–6 bullet points. Be concise and faithful.\n\n${text.slice(
          0,
          6000
        )}`
      );
      setLocalSummary(res.text || "");
    } catch (e: any) {
      Alert.alert(
        t("ocr.offline.summaryFailTitle", "Summary failed"),
        String(e?.message || e)
      );
    } finally {
      setGenBusy(false);
    }
  };

  const onGenQuestions = async () => {
    const text = (combinedText || "").trim();
    if (!text) {
      Alert.alert(
        t("ocr.offline.noTextAlertTitle", "No text"),
        t("ocr.offline.noTextAlertBody", "Run OCR before generating questions.")
      );
      return;
    }
    try {
      setGenBusy(true);
      const res = await generateAnswer(
        `Write 3–5 guiding questions a reader might ask about the following text. Keep them clear and specific.\n\n${text.slice(
          0,
          6000
        )}`
      );
      setLocalQuestions(res.text || "");
    } catch (e: any) {
      Alert.alert(
        t("ocr.offline.questionsFailTitle", "Questions failed"),
        String(e?.message || e)
      );
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <View style={styles.cardLarge}>
      {/* Header: titolo, lingua OCR, conteggio pagine */}
      <View
        style={{
          flexDirection: "column",
          gap: 4,
          alignItems: "flex-start",
        }}
      >
        <Text style={styles.sectionTitle}>{t("scan.flowTitle", "Scan and prepare")}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={styles.muted}>
            {t("settings.language", "Language")}:{" "}
            {ocrLang === "it"
              ? t("settings.italian", "Italiano")
              : t("settings.english", "English")}
          </Text>
          <View style={ocrStyles.row}>
            <TouchableOpacity
              style={[ocrStyles.toggle, ocrLang === "en" && ocrStyles.toggleActive]}
              disabled={anyBusy}
              onPress={() => handleSetLang("en")}
            >
              <Text
                style={[
                  ocrStyles.toggleText,
                  ocrLang === "en" && ocrStyles.toggleTextActive,
                ]}
              >
                {t("scan.langEnglish", "English OCR")}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ocrStyles.toggle, ocrLang === "it" && ocrStyles.toggleActive]}
              disabled={anyBusy}
              onPress={() => handleSetLang("it")}
            >
              <Text
                style={[
                  ocrStyles.toggleText,
                  ocrLang === "it" && ocrStyles.toggleTextActive,
                ]}
              >
                {t("scan.langItalian", "Italian OCR")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.muted}>
          {t("scan.pageCount", {
            count: assets.length,
          })}
        </Text>
      </View>

      {/* Backend status */}
      {backendUp !== null && (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginTop: 6,
          }}
        >
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: backendUp ? "#2ecc71" : "#e74c3c",
            }}
          />
          <Text style={styles.muted}>
            {backendUp
              ? t("scan.backend.okBadge", "Backend OK")
              : t("scan.backend.unreachableBadge", "Backend unreachable: {{status}}", {
                  status: backendStatus ?? "error",
                })}
          </Text>
          {corpusReady && (
            <Text style={[styles.muted, { marginLeft: 8 }]}>
              {t("prepare.ready", "Ready to ask")}
            </Text>
          )}
        </View>
      )}

      <LocalStatusInline showLabel={false} style={{ marginTop: 6 }} />

      {backendUp === false && (
        <View
          style={{
            marginTop: 6,
            padding: 10,
            borderRadius: 8,
            backgroundColor: "#fdecea",
            borderWidth: 1,
            borderColor: "#f5c2c7",
          }}
        >
          <Text style={{ color: "#b02a37" }}>
            {t(
              "scan.offlineBanner",
              "Can’t reach the server right now. You can still queue pages, but actions that contact the backend will be disabled."
            )}
          </Text>
        </View>
      )}

      {/* Thumbnails */}
      <ScrollView
        horizontal
        style={{ marginVertical: 8 }}
        contentContainerStyle={{ gap: 10, alignItems: "center" }}
      >
        {assets.map((a, i) => {
          const canLeft = i > 0;
          const canRight = i < assets.length - 1;
          return (
            <View
              key={a.assetId ?? a.uri ?? String(i)}
              style={{ position: "relative" }}
            >
              <View
                style={{
                  position: "absolute",
                  top: 6,
                  left: 6,
                  backgroundColor: "rgba(0,0,0,0.6)",
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#1c6a52",
                  zIndex: 2,
                }}
              >
                <Text
                  style={{ color: "white", fontWeight: "700" }}
                >
                  {i + 1}
                </Text>
              </View>

              <Image
                source={{ uri: a.uri }}
                style={{
                  width: 120,
                  height: 160,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "#1c6a52",
                }}
                resizeMode="cover"
              />

              <TouchableOpacity
                onPress={() => removeAt(i)}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  backgroundColor: "rgba(0,0,0,0.6)",
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#1c6a52",
                }}
                disabled={anyBusy}
              >
                <Text
                  style={{ color: "white", fontWeight: "700" }}
                >
                  ×
                </Text>
              </TouchableOpacity>

              <View
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: 6,
                  right: 6,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  zIndex: 3,
                }}
              >
                <TouchableOpacity
                  onPress={() => move(i, i - 1)}
                  disabled={!canLeft || anyBusy}
                  style={{
                    opacity: canLeft && !anyBusy ? 1 : 0.4,
                    backgroundColor: "#1b7f5f",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                  }}
                >
                  <Text
                    style={{
                      color: "#ffffff",
                      fontWeight: "600",
                      fontSize: 16,
                    }}
                  >
                    ←
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => move(i, i + 1)}
                  disabled={!canRight || anyBusy}
                  style={{
                    opacity: canRight && !anyBusy ? 1 : 0.4,
                    backgroundColor: "#1b7f5f",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                  }}
                >
                  <Text
                    style={{
                      color: "#ffffff",
                      fontWeight: "600",
                      fontSize: 16,
                    }}
                  >
                    →
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {assets.length === 0 && (
          <Text style={styles.muted}>
            {t("scan.noPagesYet", "No pages added yet")}
          </Text>
        )}
      </ScrollView>

      {/* Azioni principali */}
      <View
        style={{
          flexDirection: "row",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <TouchableOpacity
          onPress={() => addFrom("camera")}
          style={[styles.button, isDisabled() && styles.buttonDisabled]}
          disabled={isDisabled()}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.buttonText}>
              {t("scan.addPageCamera", "+ Add Page (Camera)")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => addFrom("library")}
          style={[styles.button, isDisabled() && styles.buttonDisabled]}
          disabled={isDisabled()}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.buttonText}>
              {t("scan.addPageGallery", "+ Add Page (Gallery)")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={retakeLast}
          style={[
            styles.button,
            (isDisabled() || assets.length === 0) && styles.buttonDisabled,
          ]}
          disabled={isDisabled() || assets.length === 0}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.buttonText}>
              {t("scan.retakeLast", "Retake last")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onAssemble}
          style={[
            styles.button,
            isDisabled(true, false, true) && styles.buttonDisabled,
          ]}
          disabled={isDisabled(true, false, true)}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.buttonText}>
              {t("scan.assemblePdf", "Assemble PDF")}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onExtractText}
          style={[
            styles.button,
            isDisabled(true, false, true) && styles.buttonDisabled,
          ]}
          disabled={isDisabled(true, false, true)}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.buttonText}>
              {t("scan.extractPages", "Extract text from pages")}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Indicazioni caricamento */}
      {anyBusy && (
        <View style={{ marginTop: 4 }}>
          <Text style={styles.muted}>
            {t("scan.processing_generic", "Processing pages...")}
          </Text>
        </View>
      )}

      {/* Testo combinato + prepare corpus + output */}
      {combinedText ? (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.sectionTitle}>
            {t(
              "scan.combinedTitle",
              "Combined text preview"
            )}
          </Text>

          <TouchableOpacity
            onPress={onPrepareFromText}
            style={[
              styles.button,
              (!combinedText.trim() || prepBusy) &&
                styles.buttonDisabled,
            ]}
            disabled={!combinedText.trim() || prepBusy}
          >
            {prepBusy ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.buttonText}>
                {t(
                  "scan.prepareFromText",
                  "Prepare corpus from text"
                )}
              </Text>
            )}
          </TouchableOpacity>

          {typeof __DEV__ !== "undefined" && __DEV__ && ocrDebug && (
            <Text
              style={[styles.muted, { marginTop: 4 }]}
            >
              {t("scan.debugLang", {
                lang: ocrDebug.langUsed ?? "?",
                n: ocrDebug.pageCount ?? "?",
              })}
            </Text>
          )}

          <ScrollView
            style={{ maxHeight: 200, marginTop: 6 }}
          >
            <Text style={styles.muted}>
              {combinedText}
            </Text>
          </ScrollView>

          {Array.isArray(pageReports) &&
            pageReports.length > 0 && (
              <View style={{ marginTop: 6 }}>
                {pageReports.map((p, idx) => {
                  const ok = !!p.text && !p.error;
                  const n = (p.index ?? idx) + 1;
                  return (
                    <Text
                      key={`${p.index ?? idx}`}
                      style={styles.muted}
                    >
                      {ok
                        ? t(
                            "scan.pageOk",
                            "✓ Page {{n}}",
                            { n }
                          )
                        : t(
                            "scan.pageFail",
                            "✗ Page {{n}} — {{error}}",
                            {
                              n,
                              error:
                                p.error ??
                                "",
                            }
                          )}
                    </Text>
                  );
                })}
              </View>
            )}

          <View
            style={{
              flexDirection: "row",
              gap: 10,
              marginTop: 8,
            }}
          >
            <TouchableOpacity
              onPress={onGenSummary}
              style={[
                styles.button,
                (genBusy || anyBusy) &&
                  styles.buttonDisabled,
              ]}
              disabled={genBusy || anyBusy}
            >
              {genBusy ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.buttonText}>
                  {t(
                    "ocr.offline.genSummary",
                    "Generate summary"
                  )}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onGenQuestions}
              style={[
                styles.button,
                (genBusy || anyBusy) &&
                  styles.buttonDisabled,
              ]}
              disabled={genBusy || anyBusy}
            >
              {genBusy ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.buttonText}>
                  {t(
                    "ocr.offline.genQuestions",
                    "Generate questions"
                  )}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {localSummary && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.sectionTitle}>
                {t(
                  "ocr.offline.outputLabel",
                  "Output"
                )}{" "}
                {t(
                  "ocr.offline.genSummary",
                  "Generate summary"
                )}
              </Text>
              <ScrollView
                style={{
                  maxHeight: 160,
                  marginTop: 6,
                }}
              >
                <Text style={styles.muted}>
                  {localSummary}
                </Text>
              </ScrollView>
            </View>
          )}

          {localQuestions && (
            <View style={{ marginTop: 8 }}>
              <Text style={styles.sectionTitle}>
                {t(
                  "ocr.offline.outputLabel",
                  "Output"
                )}{" "}
                {t(
                  "ocr.offline.genQuestions",
                  "Generate questions"
                )}
              </Text>
              <ScrollView
                style={{
                  maxHeight: 160,
                  marginTop: 6,
                }}
              >
                <Text style={styles.muted}>
                  {localQuestions}
                </Text>
              </ScrollView>
            </View>
          )}

          {!!prepMsg && (
            <Text
              style={{
                ...styles.muted,
                marginTop: 6,
              }}
            >
              {prepMsg}
            </Text>
          )}
        </View>
      ) : null}

      {/* Clear */}
      <TouchableOpacity
        onPress={onClear}
        style={[
          styles.button,
          isDisabled(true) && styles.buttonDisabled,
        ]}
        disabled={isDisabled(true)}
      >
        <Text style={styles.buttonText}>
          {t(
            "scan.clearQueue",
            "Clear queue"
          )}
        </Text>
      </TouchableOpacity>

      <Text style={styles.muted}>
        {t(
          "scan.reorderTip",
          "Tip: reorder pages so they match the reading order before running OCR."
        )}
      </Text>
    </View>
  );
}