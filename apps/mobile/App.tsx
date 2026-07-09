import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";

import { BASE_URL } from "./src/lib/client";
import {
  query as queryApi,
  prepareCorpusFromText,
  type QueryResponse,
  type PrepareCorpusResponse,
} from "./src/lib/api";
import DebugBanner from "./src/components/DebugBanner";
import MultiPageScan from "./src/features/ocr/MultiPageScan";
import Settings from "./src/screens/Settings";
import QueryScreen from "./src/screens/QueryScreen";
import "./src/i18n";
import { initLocalGen } from "./src/lib/llm/localGen";
import ToastProvider from "./src/components/Toast";
import ReachabilityBanner from "./src/components/ReachabilityBanner";

// Normalise strings (case/accents/punctuation/spacing) for safe comparisons.
function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function postJson<T>(path: string, body: any, timeoutMs = 30000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { postJSON } = await import("./src/lib/client");
    return await postJSON<T>(path, body, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type Mode = "ask" | "upload" | "scan" | "settings";

export default function App() {
  const { t } = useTranslation();

  const [mode, setMode] = useState<Mode>("ask");
  const [debugHidden, setDebugHidden] = useState(false);

  // Init local LLM stub
  useEffect(() => {
    initLocalGen({
      mode: { kind: "stub" },
      defaultSummary: { maxSentences: 2 },
      defaultQuestions: { count: 1, language: "en" },
    });
  }, []);

  // Load persisted preference for hiding the debug banner
  useEffect(() => {
    const KEY = "@eco/debug_banner_hidden";
    AsyncStorage.getItem(KEY).then((v) => {
      if (v != null) setDebugHidden(v === "1" || v === "true");
    });
  }, []);

  // Ask tab state
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Upload tab state
  const [text, setText] = useState("");
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepMsg, setPrepMsg] = useState<string | null>(null);

  async function onAsk() {
    const q = question.trim();
    if (!q) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const data = await queryApi(q);
      console.log("[App/Ask] /query response:", data);

      // Corpus not ready
      if (data.ready === false) {
        const msg =
          data.error ||
          t(
            "ask.notReadyBody",
            "No active corpus found. Run 'Prepare corpus from text' on the Upload or Scan tab first."
          );
        Alert.alert(t("ask.notReadyTitle", "Corpus not ready"), msg);
        setResult(null);
        return;
      }

      // No usable chunk
      const hasChunk =
        !!data.chunk && String(data.chunk).trim().length > 0;
      if (!hasChunk) {
        Alert.alert(
          t("ask.noMatchTitle", "No match found"),
          t(
            "ask.noMatchBody",
            "I could not find a relevant passage in the current corpus."
          )
        );
        setResult(null);
        return;
      }

      // Negative scores are allowed; low-confidence will be handled in QueryScreen.

      // All good: store as-is (UI will interpret low_confidence if set)
      setResult(data);
    } catch (e: any) {
      console.error("[App/Ask] error:", e);
      const msg =
        e?.message ||
        t("common.error.requestFailed", "Request failed.");
      setError(msg);
      Alert.alert(t("ask.failedTitle", "Ask failed"), msg);
    } finally {
      setBusy(false);
    }
  }

  async function onPrepare() {
    const txt = text.trim();
    if (txt.length < 20) {
      setPrepMsg(
        t(
          "upload.tooShort",
          "Text too short. Paste a few sentences at least."
        )
      );
      return;
    }

    setPrepBusy(true);
    setPrepMsg(null);

    try {
      const data: PrepareCorpusResponse = await prepareCorpusFromText(
        txt,
        60000
      );
      console.log("[App/Upload] /prepare_corpus response:", data);

      if (!data.ready) {
        const msg =
          data.message ||
          t(
            "upload.prepareFailed",
            "Prepare failed. Please check the text and try again."
          );
        setPrepMsg(msg);
        Alert.alert(
          t("upload.prepareFailedTitle", "Prepare failed"),
          msg
        );
        return;
      }

      const chunksLabel =
        typeof data.chunks === "number"
          ? ` (chunks: ${data.chunks})`
          : "";
      const msg =
        data.message ||
        t(
          "upload.prepared",
          "Prepared successfully{{chunks}}",
          { chunks: chunksLabel }
        );
      setPrepMsg(msg);
      Alert.alert(msg);
    } catch (e: any) {
      const msg =
        e?.message ||
        t("upload.prepareFailed", "Prepare failed.");
      setPrepMsg(msg);
      Alert.alert(
        t("upload.prepareFailedTitle", "Prepare failed"),
        msg
      );
    } finally {
      setPrepBusy(false);
    }
  }

  async function onClear() {
    setPrepBusy(true);
    setPrepMsg(null);
    try {
      await postJson("/clear_corpus", {});
      const msg = t("upload.cleared", "Corpus cleared.");
      setPrepMsg(msg);
      Alert.alert(msg);
    } catch (e: any) {
      const msg =
        e?.message ||
        t("upload.clearFailed", "Clear failed.");
      setPrepMsg(msg);
      Alert.alert(
        t("upload.clearFailedTitle", "Clear failed"),
        msg
      );
    } finally {
      setPrepBusy(false);
    }
  }

  const askButtonDisabled = busy || !question.trim();

  return (
    <ToastProvider>
      <ReachabilityBanner />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.select({
          ios: "padding",
          android: undefined,
        })}
      >
        <StatusBar style="light" />
        <View style={styles.header}>
          <Text style={styles.title}>
            {t("app.title", "EcoSearch Mobile")}
          </Text>
          <Text style={styles.subtitle}>
            {t("app.apiBase", "API")}: {BASE_URL}
          </Text>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[
              styles.tab,
              mode === "ask" && styles.tabActive,
            ]}
            onPress={() => setMode("ask")}
            disabled={mode === "ask"}
            accessibilityRole="tab"
            accessibilityState={{
              selected: mode === "ask",
            }}
          >
            <Text
              style={[
                styles.tabText,
                mode === "ask" && styles.tabTextActive,
              ]}
            >
              {t("tabs.ask", "Ask")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              mode === "upload" && styles.tabActive,
            ]}
            onPress={() => setMode("upload")}
            disabled={mode === "upload"}
            accessibilityRole="tab"
            accessibilityState={{
              selected: mode === "upload",
            }}
          >
            <Text
              style={[
                styles.tabText,
                mode === "upload" && styles.tabTextActive,
              ]}
            >
              {t(
                "tabs.uploadText",
                "Upload (text)"
              )}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.tab,
              mode === "scan" && styles.tabActive,
            ]}
            onPress={() => setMode("scan")}
            disabled={mode === "scan"}
            accessibilityRole="tab"
            accessibilityState={{
              selected: mode === "scan",
            }}
          >
            <Text
              style={[
                styles.tabText,
                mode === "scan" && styles.tabTextActive,
              ]}
            >
              {t(
                "tabs.scanPdf",
                "Scan (PDF)"
              )}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ASK TAB */}
        {mode === "ask" && <QueryScreen />}

        {/* UPLOAD TAB */}
        {mode === "upload" && (
          <View style={styles.cardLarge}>
            <Text style={styles.sectionTitle}>
              {t(
                "upload.pasteLabel",
                "Paste text to index"
              )}
            </Text>
            <ScrollView
              style={styles.chunkBox}
              keyboardShouldPersistTaps="handled"
            >
              <TextInput
                style={[
                  styles.chunkText,
                  styles.textArea,
                ]}
                multiline
                value={text}
                onChangeText={setText}
                placeholder={t(
                  "upload.placeholder",
                  "Paste content here…"
                )}
                placeholderTextColor="#8aa59d"
                editable={!prepBusy}
              />
            </ScrollView>
            <TouchableOpacity
              style={[
                styles.button,
                (prepBusy ||
                  text.trim().length <
                    20) &&
                  styles.buttonDisabled,
              ]}
              onPress={onPrepare}
              disabled={
                prepBusy ||
                text.trim().length < 20
              }
            >
              {prepBusy ? (
                <ActivityIndicator />
              ) : (
                <Text
                  style={styles.buttonText}
                >
                  {t(
                    "upload.prepareBtn",
                    "Prepare Corpus"
                  )}
                </Text>
              )}
            </TouchableOpacity>
            {prepMsg ? (
              <Text
                style={styles.muted}
              >
                {prepMsg}
              </Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.button,
                prepBusy &&
                  styles.buttonDisabled,
              ]}
              onPress={onClear}
              disabled={prepBusy}
            >
              {prepBusy ? (
                <ActivityIndicator />
              ) : (
                <Text
                  style={styles.buttonText}
                >
                  {t(
                    "upload.clearBtn",
                    "Clear Corpus"
                  )}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* SCAN TAB */}
        {mode === "scan" && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <MultiPageScan styles={styles} />
          </ScrollView>
        )}

        {/* SETTINGS TAB */}
        {mode === "settings" && (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            keyboardShouldPersistTaps="handled"
          >
            <Settings
              debugHidden={debugHidden}
              onSetDebugHidden={setDebugHidden}
            />
          </ScrollView>
        )}

        {!debugHidden && <DebugBanner />}
      </KeyboardAvoidingView>
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0b3d2e",
    alignItems: "stretch",
    justifyContent: "flex-start",
    paddingHorizontal: 16,
    paddingTop: 24,
    gap: 16,
  },
  header: { gap: 2 },
  title: {
    fontSize: 22,
    color: "#ffffff",
    fontWeight: "700",
  },
  subtitle: {
    fontSize: 12,
    color: "#b9e8d9",
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
  },
  tab: {
    flex: 1,
    backgroundColor: "#0f3f30",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1c6a52",
  },
  tabActive: {
    backgroundColor: "#124c3a",
  },
  tabText: {
    color: "#9fd7c6",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#ffffff",
  },
  card: {
    backgroundColor: "#124c3a",
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  label: {
    color: "#e6fff5",
    fontSize: 13,
    marginBottom: 4,
  },
  input: {
    backgroundColor: "#0f3f30",
    color: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#1c6a52",
  },
  button: {
    backgroundColor: "#1aa673",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 6,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#07271d",
    fontWeight: "700",
    fontSize: 16,
  },
  error: {
    color: "#ffd6d6",
    backgroundColor: "#3a0f0f",
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  cardLarge: {
    backgroundColor: "#124c3a",
    borderRadius: 14,
    padding: 14,
    gap: 10,
    flex: 1,
  },
  sectionTitle: {
    color: "#e6fff5",
    fontSize: 16,
    fontWeight: "700",
  },
  chunkBox: {
    backgroundColor: "#0f3f30",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1c6a52",
    maxHeight: 260,
  },
  chunkText: {
    color: "#ffffff",
    fontSize: 14,
    lineHeight: 20,
  },
  textArea: {
    minHeight: 140,
    textAlignVertical: "top",
  },
  muted: {
    color: "#b9e8d9",
    fontSize: 12,
    marginTop: 6,
  },
});