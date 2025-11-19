import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from "react-native";
import { useTranslation } from "react-i18next";

import { query, answerFromChunk } from "../lib/api";
import type { QueryResponse, AnswerFromChunkResponse } from "../lib/api";
import { isOffline } from "../lib/agentic";
import { useLocalEmbeddings } from "../hooks/useLocalEmbeddings";

function norm(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Sanity ping at module load
console.log("[QueryScreen] module loaded");

export default function QueryScreen() {
  const { t } = useTranslation();

  useEffect(() => {
    console.log("[QueryScreen] component mounted");
  }, []);

  const [question, setQuestion] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [res, setRes] = useState<QueryResponse | null>(null);
  const [ans, setAns] = useState<AnswerFromChunkResponse | null>(null);

  // Local embeddings (offline) state
  const {
    ready: localReady,
    busy: localBusy,
    query: queryLocal,
  } = useLocalEmbeddings();

  async function handleAsk() {
    const q = question.trim();
    if (!q) {
      Alert.alert(
        t("ask.alert.emptyTitle", "Question required"),
        t("ask.alert.emptyBody", "Please type a question before retrieving.")
      );
      return;
    }

    try {
      setBusy(true);
      setRes(null);
      setAns(null);

      // OFFLINE PATH (local embeddings)
      if (isOffline()) {
        if (!localReady) {
          Alert.alert(
            t("ask.local.notReadyTitle", "Offline not ready"),
            t(
              "ask.local.notReadyBody",
              "Prepare local embeddings first on the Scan/Upload screen."
            )
          );
          return;
        }

        const hits = await queryLocal(q, 1);
        if (!hits.length) {
          Alert.alert(
            t("ask.local.noResultsTitle", "No local results"),
            t(
              "ask.local.noResultsBody",
              "Try a different question or prepare a new local corpus."
            )
          );
          return;
        }

        const top = hits[0];
        const score =
          typeof top.score === "number" ? top.score : 0;
        const COSINE_OK = score >= 0.35;

        const localRes: Partial<QueryResponse> = {
          chunk: top.text,
          guiding_question: q,
          summary: "",
          cosine_score: score,
          score,
          low_confidence: !COSINE_OK,
          ready: true,
        };

        setRes(localRes as QueryResponse);

        const a = await answerFromChunk(q, top.text);
        setAns(a);

        return;
      }

      // ONLINE PATH (server /query endpoint)
      const out = await query(q);
      console.log("[Ask] /query response:", out);

      // 1. Corpus not ready → show a clear message
      if ((out as any)?.ready === false) {
        const msg =
          (out as any)?.error ||
          t(
            "ask.notReadyBody",
            "No active corpus found. Run 'Prepare corpus from text' on the Scan tab first."
          );
        Alert.alert(
          t("ask.notReadyTitle", "Corpus not ready"),
          msg
        );
        setRes(null);
        setAns(null);
        return;
      }

      // 2. No usable chunk → treat as no match
      const chunk = (out as any)?.chunk;
      const hasChunk =
        typeof chunk === "string" && chunk.trim().length > 0;

      if (!out || !hasChunk) {
        Alert.alert(
          t("ask.noMatchTitle", "No match found"),
          t(
            "ask.noMatchBody",
            "I could not find a relevant passage in the current corpus."
          )
        );
        setRes(null);
        setAns(null);
        return;
      }

      // 3. Flags and consistency checks
      const lowConfidence =
        (out as any)?.low_confidence === true;
      const score =
        typeof (out as any)?.score === "number"
          ? (out as any).score
          : 0;
      const guiding = (out as any)?.guiding_question || "";
      const gqMismatch =
        guiding && norm(guiding) !== norm(q);

      // Let the UI handle low_confidence and mismatches explicitly
      // (banner, icons, etc.) without discarding the retrieved chunk.
      setRes(out as QueryResponse);

      // Optional LLM answer from the chunk (if supported by your backend; otherwise remains null)
      try {
        const ansOut = await answerFromChunk(
          q,
          String(chunk)
        );
        setAns(ansOut);
      } catch (e: any) {
        console.log(
          "[Ask] answerFromChunk failed:",
          e?.message || e
        );
      }
    } catch (e: any) {
      Alert.alert(
        t("ask.errorTitle", "Error"),
        String(e?.message || e)
      );
      setRes(null);
      setAns(null);
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || localBusy;

  // RENDER
  return (
    <View
      style={{
        flex: 1,
        padding: 16,
        gap: 12,
      }}
    >
      <Text
        style={{
          fontSize: 18,
          fontWeight: "600",
        }}
      >
        {t("ask.screenTitle", "Ask the document")}
      </Text>

      <TextInput
        placeholder={t(
          "ask.placeholder",
          "Type your question…"
        )}
        value={question}
        onChangeText={setQuestion}
        style={{
          borderWidth: 1,
          borderColor: "#ddd",
          borderRadius: 8,
          padding: 12,
        }}
        editable={!disabled}
      />

      <TouchableOpacity
        onPress={handleAsk}
        style={{
          padding: 14,
          borderRadius: 10,
          backgroundColor: disabled
            ? "#4b7a68"
            : "#0b3d2e",
        }}
        disabled={disabled}
      >
        <Text
          style={{
            color: "white",
            textAlign: "center",
            fontWeight: "700",
          }}
        >
          {t("tabs.ask", "Ask")}
        </Text>
      </TouchableOpacity>

      {disabled && (
        <View
          style={{
            paddingVertical: 16,
          }}
        >
          <ActivityIndicator />
          <Text
            style={{
              textAlign: "center",
              marginTop: 8,
            }}
          >
            {t("ask.searching", "Searching…")}
          </Text>
        </View>
      )}

      {/* Risultato */}
      {(() => {
        if (!res) return null;

        const hasChunk =
          !!res.chunk &&
          String(res.chunk).trim().length > 0;
        const low = res.low_confidence === true;
        const badScore =
          typeof res.score === "number" &&
          res.score < 0;
        const gqMismatch =
          !!res.guiding_question &&
          norm(res.guiding_question) !==
            norm(question);

        console.log("[Render][Ask]", {
          low,
          badScore,
          gqMismatch,
          hasChunk,
          questionNow: question,
          guiding: res.guiding_question,
        });

        // If there is no usable chunk, do not render anything.
        if (!hasChunk) {
          return null;
        }

        // If low_confidence → we show banner warning, but still the chunk remains available.
        if (low) {
          return (
            <View
              style={{
                marginTop: 10,
                gap: 8,
              }}
            >
              <View
                style={{
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: "#fff4e5",
                  borderWidth: 1,
                  borderColor: "#f0ad4e",
                }}
              >
                <Text
                  style={{
                    fontWeight: "600",
                  }}
                >
                  {t(
                    "ask.lowConfidence",
                    "Low confidence – consider refining your question or preparing the corpus again."
                  )}
                </Text>
              </View>
              <Text
                style={{
                  fontWeight: "600",
                }}
              >
                {t("ask.topPassage", "Top passage")}
              </Text>
              <ScrollView
                style={{
                  maxHeight: 260,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  borderRadius: 8,
                }}
              >
                <Text
                  style={{
                    padding: 10,
                    lineHeight: 20,
                  }}
                >
                  {res.chunk}
                </Text>
              </ScrollView>
            </View>
          );
        }

        // Good case: we show everything
        return (
          <View
            style={{
              flex: 1,
              gap: 8,
              marginTop: 10,
            }}
          >
            <Text
              style={{
                fontWeight: "600",
              }}
            >
              {t(
                "ask.guidingQuestion",
                "Guiding question"
              )}
            </Text>
            <Text>{res.guiding_question}</Text>

            <Text
              style={{
                fontWeight: "600",
                marginTop: 8,
              }}
            >
              {t("ask.summary", "Summary")}
            </Text>
            <Text>{res.summary || "—"}</Text>

            <Text
              style={{
                fontWeight: "600",
                marginTop: 8,
              }}
            >
              {t("ask.scoreLabel", "Score")}
              {": "}
              {typeof res.score === "number"
                ? res.score.toFixed(4)
                : "—"}{" "}
              ·{" "}
              {t("ask.cosineLabel", "Cosine")}
              {": "}
              {typeof res.cosine_score === "number"
                ? Number(
                    res.cosine_score
                  ).toFixed(4)
                : "—"}
            </Text>

            <Text
              style={{
                fontWeight: "600",
                marginTop: 8,
              }}
            >
              {t(
                "ask.topPassage",
                "Top passage"
              )}
            </Text>
            <ScrollView
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 8,
              }}
            >
              <Text
                style={{
                  padding: 10,
                  lineHeight: 20,
                }}
              >
                {res.chunk}
              </Text>
            </ScrollView>

            {/* Risposta generata dal chunk (se disponibile) */}
            {ans?.answer ? (
              <View
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: "#eef7ee",
                  borderWidth: 1,
                  borderColor: "#9ad29a",
                }}
              >
                <Text
                  style={{
                    fontWeight: "700",
                    marginBottom: 4,
                  }}
                >
                  {t(
                    "ask.answerFromChunkTitle",
                    "Answer from selected passage"
                  )}
                </Text>
                <Text
                  style={{
                    lineHeight: 20,
                  }}
                >
                  {ans.answer}
                </Text>
                {ans.note ? (
                  <Text
                    style={{
                      marginTop: 6,
                      fontSize: 12,
                      opacity: 0.8,
                    }}
                  >
                    {ans.note}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })()}
    </View>
  );
}