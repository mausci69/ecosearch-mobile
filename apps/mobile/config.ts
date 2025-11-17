// Config risolto una volta sola, senza hardcodare IP che cambiano.

import Constants from "expo-constants";

function resolveBackendUrl(): string {
  // 1. Se è definita a livello di ambiente, vince sempre.
  if (process.env.EXPO_PUBLIC_BACKEND_URL) {
    return process.env.EXPO_PUBLIC_BACKEND_URL;
  }

  // 2. Prova a usare l'host di Expo (Metro bundler).
  //    Esempi:
  //    - "192.168.1.32:8081"
  //    - "192.168.1.32:19000"
  const hostUri =
    (Constants as any).expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;

  if (typeof hostUri === "string" && hostUri.length > 0) {
    const host = hostUri.split(":")[0];
    if (host && host !== "127.0.0.1" && host !== "localhost") {
      // Backend esposto sulla stessa macchina sulla porta 8000.
      return `http://${host}:8000`;
    }
  }

  // 3. Fallback: simulatore che parla con backend sulla stessa macchina.
  return "http://127.0.0.1:8000";
}

export const BACKEND_URL = resolveBackendUrl();
export const API_BASE_URL = BACKEND_URL;