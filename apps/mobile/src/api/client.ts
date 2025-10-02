export const API_BASE_URL = "http://192.168.1.112:8000";

console.log("[client] API_BASE_URL =", API_BASE_URL);

type HTTPMethod = "GET" | "POST";

const jitter = (baseMs: number) => Math.floor(baseMs * (1 + Math.random()));

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function requestWithRetry<T>(
  path: string,
  opts: {
    method?: HTTPMethod;
    body?: any;
    headers?: Record<string, string>;
    retries?: number;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    retries = 1,
    timeoutMs = 30000
  } = opts;

  const url = path.startsWith("http")
    ? path
    : `${API_BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;

  let lastErr: any;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal
      };

      if (body instanceof FormData) {
        // Let the browser set the multipart boundary
        init.body = body;
      } else if (body != null) {
        init.body = JSON.stringify(body);
        init.headers = { ...headers, "content-type": "application/json" };
      }

      const res = await fetch(url, init);

      clearTimeout(timer);

      // Retry on backend lock (423)
      if (res.status === 423 && attempt < retries) {
        await new Promise((r) => setTimeout(r, jitter(350)));
        continue;
      }

      if (!res.ok) {
        const text = await safeText(res);
        throw new Error(
          `HTTP ${res.status} ${res.statusText}: ${text?.slice(0, 400)}`
        );
      }

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        return (await res.json()) as T;
      }
      return (await res.text()) as unknown as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, jitter(300)));
        continue;
      }
    }
  }

  throw lastErr;
}

export function get<T>(path: string, timeoutMs?: number) {
  return requestWithRetry<T>(path, { method: "GET", timeoutMs });
}

export function postJson<T>(path: string, body: any, timeoutMs?: number) {
  return requestWithRetry<T>(path, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
    timeoutMs
  });
}

export function isLocked423(e: unknown) {
  return e instanceof Error && /HTTP 423/.test(e.message);
}