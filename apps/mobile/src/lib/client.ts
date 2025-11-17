/**
 * Centralised API client for EcoSearch Mobile.
 * Uses EXPO_PUBLIC_BACKEND_URL; falls back to http://localhost:8000 for dev.
 */
import { BACKEND_URL } from "../../config";

const BASE_URL = BACKEND_URL;

export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${BASE_URL}${p}`;
}

export async function getJSON<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "GET",
    headers: { Accept: "application/json", ...(init.headers || {}) },
    ...init,
  });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export async function postJSON<T = any>(
  path: string,
  body: unknown,
  init: RequestInit = {}
  ): Promise<T> {
    const url = apiUrl(path);
    console.log("[client] POST", url, "body:", body);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    console.log("[client] status", res.status, "raw:", text.slice(0, 1000));

    if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      console.warn("[client] JSON parse error:", String(e));
    }
    return json as T;
}

export async function postFormData<T = any>(
  path: string,
  formData: FormData,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    body: formData,
    ...(init || {}),
  });
  if (!res.ok) throw new Error(`POST(form) ${path} failed: ${res.status}`);

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/pdf") || ct.includes("application/octet-stream")) {
    return (await res.blob()) as any as T;
  }
  if (ct.includes("application/json")) {
    return (await res.json()) as T;
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as any as T;
  }
}

export async function pingHealth(
  timeoutMs = 2000
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(apiUrl("/health"), {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(id);
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    clearTimeout(id);
    return { ok: false, error: String(err?.message || err) };
  }
}

// Optional: log active backend in dev
if (__DEV__) {
  // eslint-disable-next-line no-console
  console.log("[EcoSearch] Backend URL:", BASE_URL);
}

export { BASE_URL };