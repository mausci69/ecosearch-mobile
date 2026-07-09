// apps/mobile/src/features/ocr/MultiPageScan.tsx
console.log("NEW SCAN LOADED");

import React, { useEffect, useMemo, useState } from "react";
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
import type { ImagePickerAsset } from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import { getOcrLang, setOcrLang as setGlobalOcrLang } from "../../lib/lang";
import { ocrExtractPagesSmart, prepareCorpusFromText, health } from "../../lib/api";
import { pickImageAsset } from "./pickImage";
import { generateAnswer } from "../../lib/generate";
// import LocalStatusInline from "../../components/LocalStatusInline";

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

const ui = StyleSheet.create({
  // Remove the “lighter green panel” effect by making the container transparent.
  // (We keep card spacing/layout but kill the background.)
  cardNoPanel: {
    backgroundColor: "transparent",
    borderWidth: 0,
  },

  iconsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 10,
    backgroundColor: "transparent",
  },

  iconButton: {
    flex: 1,
    height: 96,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "transparent",
    borderWidth: 0,
  },

  iconButtonLeft: { marginRight: 10 },
  iconButtonRight: { marginLeft: 10 },

  iconText: {
    fontSize: 96,
    fontWeight: "700",
    lineHeight: 96,
  },

  buttonRow: {
    marginTop: 14,
  },

  bigButton: {
    width: "100%",
    height: 64,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },

  bigButtonText: {
    fontSize: 18,
    fontWeight: "800",
  },
});

export default function MultiPageScan({ styles }: Props) {
  const { t } = useTranslation();

  const [ocrLang, setOcrLangState] = useState<"en" | "it">("en");
  const [assets, setAssets] = useState<ImagePickerAsset[]>([]);
  const [combinedText, setCombinedText] = useState<string>("");

  const [corpusReady, setCorpusReady] = useState<boolean>(false);
  const [prepBusy, setPrepBusy] = useState<boolean>(false);
  const [prepMsg, setPrepMsg] = useState<string>("");

  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  const [busy, setBusy] = useState<boolean>(false);
  const [genBusy, setGenBusy] = useState<boolean>(false);
  const [localSummary, setLocalSummary] = useState<string | null>(null);
  const [localQuestions, setLocalQuestions] = useState<string | null>(null);

  const [pageReports, setPageReports] = useState<
    { index: number; text?: string; error?: string }[] | null
  >(null);

  const anyBusy = useMemo(() => busy || prepBusy || genBusy, [busy, prepBusy, genBusy]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const h = await health();
        if (!cancelled) setBackendUp(h?.status === "ok");
      } catch {
        if (!cancelled) setBackendUp(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resetDerived = () => {
    setCombinedText("");
    setPrepMsg("");
    setPrepBusy(false);
    setPageReports(null);
    setLocalSummary(null);
    setLocalQuestions(null);
    setGenBusy(false);
    setCorpusReady(false);
  };

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

      const actions: ImageManipulator.Action[] = [];
      if (w && h) {
        const maxDim = Math.max(w, h);
        if (maxDim > MAX_DIM) {
          const scale = MAX_DIM / maxDim;
          actions.push({
            resize: {
              width: Math.round(w * scale),
              height: Math.round(h * scale),
            },
          });
        }
      }

      const result = await ImageManipulator.manipulateAsync(asset.uri, actions, {
        compress: COMPRESS,
        format: ImageManipulator.SaveFormat.JPEG,
      });

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
    resetDerived();
  };

  const addFrom = async (source: "camera" | "library") => {
    try {
      const asset = await pickImageAsset(source);
      if (!asset) return;

      const processed = await maybeDownscaleAsset(asset);

      // Multi-page behaviour: append.
      setAssets((prev) => [...prev, processed]);
      resetDerived();
    } catch (e: any) {
      Alert.alert(
        t(
          source === "camera"
            ? "scan.alert.cameraErrorTitle"
            : "scan.alert.galleryErrorTitle"
        ),
        t(
          source === "camera"
            ? "scan.alert.cameraErrorBody"
            : "scan.alert.galleryErrorBody",
          { detail: String(e?.message ?? "") }
        )
      );
    }
  };

  const removeAt = (idx: number) => {
    setAssets((prev) => prev.filter((_, i) => i !== idx));
    resetDerived();
  };

  const move = (from: number, to: number) => {
    setAssets((prev) => {
      if (to < 0 || to >= prev.length) return prev;
      const copy = prev.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
    resetDerived();
  };

  const buildFilesForm = () => {
    const form = new FormData();
    assets.forEach((a, i) => {
      form.append(
        "files",
        {
          uri: a.uri,
          name: a.fileName || `page_${i + 1}.jpg`,
          type: (a as any).mimeType || "image/jpeg",
        } as any
      );
    });
    return form;
  };

  const onPrepareCorpus = async () => {
    if (!assets.length) return;

    try {
      setBusy(true);
      setPrepBusy(true);
      setPrepMsg("");
      setCorpusReady(false);

      const h = await health();
      if (!h || h.status !== "ok") {
        Alert.alert(
          t("scan.backend.unreachableTitle", "Server not reachable"),
          t(
            "scan.backend.unreachableBody",
            "Check that the EcoSearch backend is running and your device is on the same Wi-Fi."
          )
        );
        return;
      }

      const form = buildFilesForm();
      const ocrRes: any = await ocrExtractPagesSmart(assets.map((a, i) => ({ uri: a.uri, name: `page-${i + 1}.jpg` })), form, { lang: ocrLang });

      const extracted = String(ocrRes?.text || "").trim();
      setCombinedText(extracted);

      setPageReports(
        Array.isArray(ocrRes?.pages)
          ? ocrRes.pages.map((text: string, index: number) => ({
              index,
              text,
              error: text ? undefined : "Empty OCR result",
            }))
          : null
      );

      if (!extracted) {
        Alert.alert(
          t("prepare.tooShortTitle", "Text too short"),
          t(
            "prepare.tooShortBody",
            "OCR returned no usable text. Please retake the photo and try again."
          )
        );
        return;
      }

      const prepRes: any = await prepareCorpusFromText(extracted);

      if (prepRes && prepRes.ready) {
        setCorpusReady(true);
        setPrepMsg(prepRes.message || t("prepare.ready", "Ready to ask"));
      } else {
        const msg =
          (prepRes && (prepRes.message || prepRes.status)) ||
          t("prepare.failedGeneric", "Could not prepare corpus. Please try again.");
        setPrepMsg(msg);
        setCorpusReady(false);
      }
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      const detail = e?.body?.detail ?? e?.response?.data?.detail ?? e?.message ?? e;

      Alert.alert(
        t("upload.prepareFailedTitle", "Prepare failed") + (status ? ` (HTTP ${status})` : ""),
        String(detail)
      );
      setCorpusReady(false);
    } finally {
      setPrepBusy(false);
      setBusy(false);
    }
  };

  return (
    <View style={[styles.cardLarge, ui.cardNoPanel]}>
      {/* Row 1: 2 big icons */}
      <View style={ui.iconsRow}>
        <TouchableOpacity
          onPress={() => addFrom("camera")}
          style={[
            styles.button,
            ui.iconButton,
            isDisabled() && styles.buttonDisabled,
          ]}
          disabled={isDisabled()}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={[styles.buttonText, ui.iconText]}>📷</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => addFrom("library")}
          style={[
            styles.button,
            ui.iconButton,
            isDisabled() && styles.buttonDisabled,
          ]}
          disabled={isDisabled()}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={[styles.buttonText, ui.iconText]}>🖼</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Thumbnails */}
        <ScrollView
          horizontal
          style={{ marginVertical: 14 }}
          contentContainerStyle={{ gap: 10, alignItems: "center", justifyContent: "center", flexGrow: 1 }}
        >
        {assets.map((a, i) => {
          const canLeft = i > 0;
          const canRight = i < assets.length - 1;

          return (
            <View key={a.assetId ?? a.uri ?? String(i)} style={{ position: "relative" }}>
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
                <Text style={{ color: "white", fontWeight: "700" }}>×</Text>
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
              </View>
            </View>
          );
        })}
      </ScrollView>
      {/* Row 2: big button */}
      <View style={ui.buttonRow}>
        <TouchableOpacity
          onPress={onPrepareCorpus}
          style={[
            styles.button,
            ui.bigButton,
            isDisabled(true, false, true) && styles.buttonDisabled,
          ]}
          disabled={isDisabled(true, false, true)}
        >
          {anyBusy ? (
            <ActivityIndicator />
          ) : (
            <Text style={[styles.buttonText, ui.bigButtonText]}>
              {t("scan.prepareCorpus", "Prepare Corpus")}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {!!combinedText.trim() && (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.sectionTitle}>{t("scan.combinedTitle", "Extracted text")}</Text>
          <ScrollView style={{ maxHeight: 240, marginTop: 8 }}>
            <Text style={styles.muted}>{combinedText}</Text>
          </ScrollView>
          {!!prepMsg && <Text style={[styles.muted, { marginTop: 10 }]}>{prepMsg}</Text>}
        </View>
      )}
    </View>
  );
}