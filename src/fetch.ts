/**
 * Fetch pages and parse their Open Graph metadata.
 *
 * Each page is read only as far as `</head>` (or `OPENGRAPH_MAX_BYTES`), which
 * is where Open Graph tags live, so large pages cost little. A failed fetch
 * never fails the query: it comes back as a row with `error` set, so one dead
 * link in a column of thousands doesn't lose the rest.
 *
 * Tuning (environment variables, read once at start-up):
 *   OPENGRAPH_TIMEOUT_MS   per-request timeout, including redirects (default 10000)
 *   OPENGRAPH_MAX_BYTES    most bytes read from one response (default 2097152)
 *   OPENGRAPH_CONCURRENCY  parallel requests per batch (default 8)
 *   OPENGRAPH_USER_AGENT   User-Agent header
 */

import { log } from "./log.ts";
import { VERSION } from "./meta.ts";
import { type OpenGraph, scanDocument, summarize } from "./parse.ts";

export interface FetchedOpenGraph extends OpenGraph {
  final_url: string | null;
  http_status: number | null;
  content_type: string | null;
  error: string | null;
}

function envInt(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

export const CONFIG = {
  timeoutMs: envInt("OPENGRAPH_TIMEOUT_MS", 10_000, 1),
  maxBytes: envInt("OPENGRAPH_MAX_BYTES", 2 * 1024 * 1024, 1024),
  concurrency: envInt("OPENGRAPH_CONCURRENCY", 8, 1),
  userAgent:
    process.env.OPENGRAPH_USER_AGENT ??
    `Mozilla/5.0 (compatible; vgi-opengraph/${VERSION}; +https://github.com/Query-farm/vgi-opengraph)`,
  retries: 2,
};

const EMPTY: OpenGraph = summarize(scanDocument(""), null);

function failure(error: string, extra: Partial<FetchedOpenGraph> = {}): FetchedOpenGraph {
  return { ...EMPTY, images: [], final_url: null, http_status: null, content_type: null, error, ...extra };
}

const RETRY_STATUS = new Set([429, 502, 503, 504]);

function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get("retry-after");
  const seconds = header == null ? Number.NaN : Number(header);
  const wanted = Number.isFinite(seconds) ? seconds * 1000 : 500 * 2 ** attempt;
  return Math.min(Math.max(wanted, 0), 5_000);
}

const HEAD_END = /<\/head\s*>|<body[\s>]/i;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i;

/** Read at most `maxBytes`, stopping early once the document head is over. */
async function readHead(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // ASCII view of the bytes so far, to spot `</head>` regardless of charset.
  const ascii = new TextDecoder("latin1");
  let tail = "";
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const chunk = value.byteLength > maxBytes - total ? value.subarray(0, maxBytes - total) : value;
      chunks.push(chunk);
      total += chunk.byteLength;
      const text = tail + ascii.decode(chunk);
      if (HEAD_END.test(text)) break;
      tail = text.slice(-16);
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Decode with the charset from Content-Type, else `<meta charset>`, else UTF-8. */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  let label = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType ?? "")?.[1];
  if (!label) {
    const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
    label = META_CHARSET.exec(head)?.[1] ?? /<meta[^>]+content=["'][^"']*charset=([A-Za-z0-9_.:-]+)/i.exec(head)?.[1];
  }
  try {
    return new TextDecoder((label ?? "utf-8") as ConstructorParameters<typeof TextDecoder>[0]).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function isHtml(contentType: string | null): boolean {
  if (!contentType) return true; // no header: sniff it as HTML
  const t = contentType.toLowerCase();
  return t.includes("html") || t.includes("xml") || t.startsWith("text/plain");
}

/** Fetch one URL and parse it. Never throws. */
export async function fetchOpenGraph(url: string, config = CONFIG): Promise<FetchedOpenGraph> {
  let target: URL;
  try {
    target = new URL(url.trim());
  } catch {
    return failure(`invalid URL: ${url}`);
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return failure(`unsupported URL scheme '${target.protocol.replace(/:$/, "")}': only http and https are fetched`);
  }

  const signal = AbortSignal.timeout(config.timeoutMs);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(target, {
        redirect: "follow",
        signal,
        headers: {
          "user-agent": config.userAgent,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
          "accept-language": "en;q=0.9,*;q=0.5",
        },
      });
    } catch (err) {
      const e = err as Error;
      const msg =
        e.name === "TimeoutError" || e.name === "AbortError"
          ? `timed out after ${config.timeoutMs} ms`
          : `request failed: ${e.message}`;
      log.debug(`fetch ${target.href}: ${msg}`);
      return failure(msg);
    }

    const finalUrl = res.url || target.href;
    const contentType = res.headers.get("content-type");
    const meta = { final_url: finalUrl, http_status: res.status, content_type: contentType };

    if (RETRY_STATUS.has(res.status) && attempt < config.retries) {
      res.body?.cancel().catch(() => {});
      await Bun.sleep(retryDelayMs(res, attempt));
      continue;
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return failure(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`, meta);
    }
    if (!isHtml(contentType)) {
      res.body?.cancel().catch(() => {});
      return failure(`not an HTML page (content type ${contentType})`, meta);
    }
    try {
      const html = decodeBody(await readHead(res, config.maxBytes), contentType);
      return { ...summarize(scanDocument(html), finalUrl), ...meta, error: null };
    } catch (err) {
      return failure(`could not read the response: ${(err as Error).message}`, meta);
    }
  }
}

/** Fetch a column of URLs with bounded concurrency; repeated URLs are fetched once. */
export async function fetchAll(urls: (string | null)[], config = CONFIG): Promise<(FetchedOpenGraph | null)[]> {
  const unique = [...new Set(urls.filter((u): u is string => u != null))];
  const results = new Map<string, FetchedOpenGraph>();
  let next = 0;
  const workers = Array.from({ length: Math.min(config.concurrency, unique.length) }, async () => {
    while (next < unique.length) {
      const url = unique[next++] as string;
      results.set(url, await fetchOpenGraph(url, config));
    }
  });
  await Promise.all(workers);
  return urls.map((u) => (u == null ? null : (results.get(u) ?? null)));
}
