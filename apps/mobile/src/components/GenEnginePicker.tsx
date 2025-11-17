import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator } from "react-native";
import { useTranslation } from "react-i18next";
import { GEN_ENGINE_OPTIONS, type GenEngine } from "../constants/genEngine";
import { getGenEngine, setGenEngine } from "../constants/storage";

// Simple radio-list picker for Generation Engine (Server / Local / Auto / Simulator).
// Keeps state in AsyncStorage via getGenEngine/setGenEngine.
// British English in comments.

type Props = {
  title?: string;          // optional heading above the picker
  onChanged?: (engine: GenEngine) => void; // notify parent when selection changes
};

export default function GenEnginePicker({ title, onChanged }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [value, setValue] = useState<GenEngine>("server");

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const v = await getGenEngine();
        if (on) setValue(v);
      } finally {
        if (on) setLoading(false);
      }
    })();
    return () => {
      on = false;
    };
  }, []);

  const handleSelect = async (v: GenEngine) => {
    setValue(v);
    await setGenEngine(v);
    onChanged?.(v);
  };

  if (loading) {
    return (
      <View style={{ paddingVertical: 8 }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text style={{ fontWeight: "600", fontSize: 16, marginBottom: 4 }}>
          {title}
        </Text>
      ) : null}

      {GEN_ENGINE_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            onPress={() => handleSelect(opt.value)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: selected ? "#3b82f6" : "#444",
              backgroundColor: selected ? "#1f2937" : "transparent",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <Text style={{ fontSize: 15 }}>
              {t(opt.labelKey)} {/* e.g. settings.genEngine.server */}
            </Text>
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                borderWidth: 2,
                borderColor: selected ? "#3b82f6" : "#666",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {selected ? (
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                  }}
                />
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

