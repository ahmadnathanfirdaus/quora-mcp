import { loadHtml } from "./browser.js";
import { config } from "./config.js";
import {
  normalizeQuestionUrl,
  type Profile,
  parseDdgResults,
  parseProfile,
  parseQuestionPage,
  parseQuoraSearch,
  profileUrl,
  type Question,
  type SearchHit,
} from "./parse.js";
import { Throttle, TtlCache } from "./util.js";

const throttle = new Throttle(config.maxConcurrency, config.minDelayMs);
const cache = new TtlCache<unknown>(config.cacheTtlMs, config.cacheMax);

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as T | undefined;
  if (hit !== undefined) return hit;
  const v = await fn();
  cache.set(key, v);
  return v;
}

export type Lang = "any" | "en" | "id";

const HOST: Record<Exclude<Lang, "any">, string> = { en: "www.quora.com", id: "id.quora.com" };

export interface SearchResult {
  query: string;
  via: "quora" | "duckduckgo";
  results: SearchHit[];
}

export async function search(query: string, limit: number, lang: Lang): Promise<SearchResult> {
  return cached(`s:${lang}:${limit}:${query}`, async () => {
    // Native Quora search needs a logged-in session; otherwise fall back to a web search.
    if (config.quoraCookie) {
      const host = lang === "any" ? HOST.en : HOST[lang];
      const url = `https://${host}/search?q=${encodeURIComponent(query)}&type=question`;
      const { html, finalUrl } = await throttle.run(() => loadHtml(url, { scrolls: 2 }));
      const results = parseQuoraSearch(html, finalUrl, limit);
      if (results.length) return { query, via: "quora", results };
    }
    const site = lang === "any" ? "quora.com" : HOST[lang];
    const results = await throttle.run(() => ddg(`site:${site} ${query}`, limit));
    return { query, via: "duckduckgo", results };
  });
}

async function ddg(q: string, limit: number): Promise<SearchHit[]> {
  const res = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": config.userAgent,
      "accept-language": "en-US,en;q=0.9,id;q=0.8",
    },
    body: new URLSearchParams({ q }).toString(),
    signal: AbortSignal.timeout(config.navTimeoutMs),
  });
  if (!res.ok) throw new Error(`DuckDuckGo search failed: HTTP ${res.status}`);
  return parseDdgResults(await res.text(), limit);
}

export async function getQuestion(rawUrl: string, maxAnswers: number, maxChars: number): Promise<Question> {
  const url = normalizeQuestionUrl(rawUrl);
  if (!url) throw new Error(`Not a Quora question/answer URL: ${rawUrl}`);
  return cached(`q:${url}:${maxAnswers}:${maxChars}`, async () => {
    const scrolls = Math.min(6, Math.ceil(maxAnswers / 4));
    const { html, finalUrl, status } = await throttle.run(() => loadHtml(url, { scrolls, expand: true }));
    if (status === 404) throw new Error(`Question not found (404): ${url}`);
    const q = parseQuestionPage(html, finalUrl, maxAnswers, maxChars);
    if (status === 403 || status === 429) q.warnings.push(`Quora returned HTTP ${status} (rate limited / blocked).`);
    return q;
  });
}

export async function getProfile(input: string): Promise<Profile> {
  const url = profileUrl(input);
  return cached(`p:${url}`, async () => {
    const { html, finalUrl, status } = await throttle.run(() => loadHtml(url, { scrolls: 1 }));
    if (status === 404) throw new Error(`Profile not found (404): ${url}`);
    return parseProfile(html, finalUrl);
  });
}
