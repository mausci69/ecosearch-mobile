import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";

import MultiPageScan from "./src/features/ocr/MultiPageScan";
import QueryScreen from "./src/screens/QueryScreen";
import Settings from "./src/screens/Settings";
import ToastProvider from "./src/components/Toast";
import { initLocalGen } from "./src/lib/llm/localGen";
import "./src/i18n";

type Mode = "scan" | "ask" | "settings";

export default function App() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("scan");
  const [debugHidden, setDebugHidden] = useState(true);

  useEffect(() => {
    initLocalGen({
      mode: { kind: "stub" },
      defaultSummary: { maxSentences: 2 },
      defaultQuestions: { count: 1, language: "en" },
    });
  }, []);

  const tabs: Array<{ key: Mode; label: string }> = [
    { key: "scan", label: t("tabs.scan", "Scan") },
    { key: "ask", label: t("tabs.ask", "Ask") },
    { key: "settings", label: t("tabs.settings", "Settings") },
  ];

  return (
    <ToastProvider>
      <KeyboardAvoidingView
        style={styles.app}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <StatusBar style="light" />

        <View style={styles.header}>
          <Text style={styles.title}>EcoSearch Mobile</Text>
          <Text style={styles.subtitle}>
            Scan documents, prepare a local corpus, then ask evidence-first questions.
          </Text>
        </View>

        <View style={styles.tabs}>
          {tabs.map((tab) => {
            const active = mode === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                onPress={() => setMode(tab.key)}
                disabled={active}
                style={[styles.tab, active && styles.tabActive]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {mode === "scan" && (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <MultiPageScan styles={styles} />
          </ScrollView>
        )}

        {mode === "ask" && (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <QueryScreen />
          </ScrollView>
        )}

        {mode === "settings" && (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          >
            <Settings
              debugHidden={debugHidden}
              onSetDebugHidden={setDebugHidden}
            />
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </ToastProvider>
  );
}

const styles = StyleSheet.create({
  app: {
    flex: 1,
    backgroundColor: "#061f19",
    paddingTop: 54,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
  },
  title: {
    color: "#f4fff9",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "#b9d8ce",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  tabs: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  tab: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#245f50",
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "#0b2b23",
  },
  tabActive: {
    backgroundColor: "#e8fff5",
    borderColor: "#e8fff5",
  },
  tabText: {
    color: "#d7f7ec",
    fontSize: 14,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#05251d",
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: 14,
    paddingBottom: 34,
  },
  cardLarge: {
    backgroundColor: "#0b2b23",
    borderWidth: 1,
    borderColor: "#1c6a52",
    borderRadius: 18,
    padding: 14,
  },
  card: {
    backgroundColor: "#0b2b23",
    borderWidth: 1,
    borderColor: "#1c6a52",
    borderRadius: 16,
    padding: 14,
  },
  sectionTitle: {
    color: "#f4fff9",
    fontSize: 16,
    fontWeight: "800",
  },
  muted: {
    color: "#b9d8ce",
    fontSize: 13,
    lineHeight: 19,
  },
  button: {
    borderRadius: 14,
    backgroundColor: "#1f8f6d",
    paddingVertical: 13,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "800",
    fontSize: 15,
  },
});
