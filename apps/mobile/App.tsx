import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { API_BASE_URL } from "./src/api/client";

type QueryResponse = {
  chunk?: string;
  alt_chunk?: string;
  trace?: { duration_ms?: number };
};

async function postJson<T>(path: string, body: any, timeoutMs = 30000): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  console.log("[postJson] →", url, body ? `(bytes ~${JSON.stringify(body).length})` : "");

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}: ${txt.slice(0, 300)}`);
    }

    const ct = res.headers.get("content-type") ?? "";
    return (ct.includes("application/json")
      ? await res.json()
      : ((await res.text()) as any)) as T;
  } catch (e) {
    console.error("[postJson] error:", e);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Mode = "ask" | "upload";

export default function App() {
  const [mode, setMode] = useState<Mode>("ask");

  // Ask
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Upload text
  const [text, setText] = useState("");
  const [prepBusy, setPrepBusy] = useState(false);
  const [prepMsg, setPrepMsg] = useState<string | null>(null);

  const onAsk = async () => {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const data = await postJson<QueryResponse>("/query", { question: q, use_rerank: true }, 30000);
      setResult(data);
    } catch (e: any) {
      console.error("[postJson] error:", e);
      const msg = e?.message ?? "Request failed.";
      setPrepMsg(msg);
    } finally {
      setBusy(false);
    }
  };

  const onPrepare = async () => {
    const t = text.trim();
    if (t.length < 20) {
      setPrepMsg("Text too short. Paste a few sentences at least.");
      return;
    }
    setPrepBusy(true);
    setPrepMsg(null);
    try {
      const data = await postJson<{ status: string; chunks?: number }>("/prepare_corpus", {
        text: t,
        reset: true,
      }, 60000);
      setPrepMsg(`Prepared: ${data.status}${data.chunks != null ? ` (chunks: ${data.chunks})` : ""}`);
    } catch (e: any) {
      setPrepMsg(e?.message ?? "Prepare failed.");
    } finally {
      setPrepBusy(false);
    }
  };

  const onClear = async () => {
    setPrepBusy(true);
    setPrepMsg(null);
    try {
      await postJson("/clear_corpus", {});
      setPrepMsg("Corpus cleared.");
    } catch (e: any) {
      setPrepMsg(e?.message ?? "Clear failed.");
    } finally {
      setPrepBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.select({ ios: "padding", android: undefined })}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>EcoSearch Mobile</Text>
        <Text style={styles.subtitle}>API: {API_BASE_URL}</Text>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, mode === "ask" && styles.tabActive]} onPress={() => setMode("ask")} disabled={mode === "ask"}>
          <Text style={[styles.tabText, mode === "ask" && styles.tabTextActive]}>Ask</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === "upload" && styles.tabActive]} onPress={() => setMode("upload")} disabled={mode === "upload"}>
          <Text style={[styles.tabText, mode === "upload" && styles.tabTextActive]}>Upload (text)</Text>
        </TouchableOpacity>
      </View>

      {mode === "ask" ? (
        <>
          <View style={styles.card}>
            <Text style={styles.label}>Your question</Text>
            <TextInput
              style={styles.input}
              placeholder="Type your question…"
              placeholderTextColor="#8aa59d"
              value={question}
              onChangeText={setQuestion}
              editable={!busy}
              returnKeyType="send"
              onSubmitEditing={onAsk}
            />
            <TouchableOpacity
              style={[styles.button, (busy || !question.trim()) && styles.buttonDisabled]}
              onPress={onAsk}
              disabled={busy || !question.trim()}
            >
              {busy ? <ActivityIndicator /> : <Text style={styles.buttonText}>Retrieve best chunk</Text>}
            </TouchableOpacity>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>

          {result?.chunk ? (
            <View style={styles.cardLarge}>
              <Text style={styles.sectionTitle}>Top chunk</Text>
              <ScrollView style={styles.chunkBox}>
                <Text style={styles.chunkText}>{result.chunk}</Text>
              </ScrollView>
              {result?.trace?.duration_ms ? <Text style={styles.muted}>Time: {result.trace.duration_ms} ms</Text> : null}
            </View>
          ) : null}
        </>
      ) : (
        <>
          <View style={styles.cardLarge}>
            <Text style={styles.sectionTitle}>Paste text to index</Text>
            <ScrollView style={styles.chunkBox}>
              <TextInput
                style={[styles.chunkText, styles.textArea]}
                multiline
                value={text}
                onChangeText={setText}
                placeholder="Paste content here…"
                placeholderTextColor="#8aa59d"
                editable={!prepBusy}
              />
            </ScrollView>

            <TouchableOpacity style={[styles.button, prepBusy && styles.buttonDisabled]} onPress={onPrepare} disabled={prepBusy}>
              {prepBusy ? <ActivityIndicator /> : <Text style={styles.buttonText}>Prepare Corpus</Text>}
            </TouchableOpacity>

            <TouchableOpacity style={[styles.button, prepBusy && styles.buttonDisabled]} onPress={onClear} disabled={prepBusy}>
              {prepBusy ? <ActivityIndicator /> : <Text style={styles.buttonText}>Clear Corpus</Text>}
            </TouchableOpacity>

            {prepMsg ? <Text style={styles.muted}>{prepMsg}</Text> : null}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b3d2e", alignItems: "stretch", justifyContent: "flex-start", paddingHorizontal: 16, paddingTop: 24, gap: 16 },
  header: { gap: 2 },
  title: { fontSize: 22, color: "#ffffff", fontWeight: "700" },
  subtitle: { fontSize: 12, color: "#b9e8d9" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: { flex: 1, backgroundColor: "#0f3f30", borderRadius: 10, paddingVertical: 10, alignItems: "center", borderWidth: 1, borderColor: "#1c6a52" },
  tabActive: { backgroundColor: "#124c3a" },
  tabText: { color: "#9fd7c6", fontWeight: "600" },
  tabTextActive: { color: "#ffffff" },
  card: { backgroundColor: "#124c3a", borderRadius: 14, padding: 14, gap: 10 },
  label: { color: "#e6fff5", fontSize: 13, marginBottom: 4 },
  input: { backgroundColor: "#0f3f30", color: "#ffffff", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#1c6a52" },
  button: { backgroundColor: "#1aa673", borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 6 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#07271d", fontWeight: "700", fontSize: 16 },
  error: { color: "#ffd6d6", backgroundColor: "#3a0f0f", borderRadius: 8, padding: 8, marginTop: 8 },
  cardLarge: { backgroundColor: "#124c3a", borderRadius: 14, padding: 14, gap: 10, flex: 1 },
  sectionTitle: { color: "#e6fff5", fontSize: 16, fontWeight: "700" },
  chunkBox: { backgroundColor: "#0f3f30", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#1c6a52", maxHeight: 260 },
  chunkText: { color: "#ffffff", fontSize: 14, lineHeight: 20 },
  textArea: { minHeight: 140, textAlignVertical: "top" },
  muted: { color: "#b9e8d9", fontSize: 12, marginTop: 6 },
});
