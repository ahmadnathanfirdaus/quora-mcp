import * as cheerio from "cheerio";
import { clean, htmlToText, truncate } from "./util.js";

// ---------- URL helpers ----------

const RESERVED = new Set([
  "profile",
  "topic",
  "search",
  "q",
  "answer",
  "about",
  "unanswered",
  "partners",
  "spaces",
  "settings",
  "notifications",
  "following",
  "answers",
  "content",
  "stats",
  "ads",
  "contact",
  "careers",
  "press",
  "privacy",
  "tos",
  "login",
  "signup",
  "main",
  "bookmarks",
  "drafts",
  "business",
  "poe_api",
  "challenges",
  "messages",
]);

/** Resolve a possibly relative href against a base; null for missing or malformed hrefs. */
function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function isQuoraHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === "quora.com" || h.endsWith(".quora.com");
}

/** Turn any Quora question or answer URL into its canonical question URL, else null. */
export function normalizeQuestionUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw, "https://www.quora.com");
  } catch {
    return null;
  }
  if (!isQuoraHost(u.hostname)) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  const first = decodeURIComponent(segs[0]);
  if (RESERVED.has(first.toLowerCase())) return null;
  if (segs.length > 1 && segs[1] !== "answer" && segs[1] !== "answers") return null;
  // Question slugs are hyphenated words; reject single short tokens like "/home"
  if (!first.includes("-")) return null;
  const host = u.hostname === "quora.com" ? "www.quora.com" : u.hostname;
  return `https://${host}/${segs[0]}`;
}

export function profileUrl(input: string, host = "www.quora.com"): string {
  if (/^https?:\/\//i.test(input)) {
    const u = new URL(input);
    if (!isQuoraHost(u.hostname) || !u.pathname.startsWith("/profile/")) {
      throw new Error("Not a Quora profile URL");
    }
    return `https://${u.hostname}/profile/${u.pathname.split("/")[2]}`;
  }
  const slug = input.trim().replace(/^@/, "").replace(/\s+/g, "-");
  return `https://${host}/profile/${encodeURIComponent(slug)}`;
}

function slugToTitle(url: string): string {
  const seg = decodeURIComponent(new URL(url).pathname.split("/")[1] ?? "");
  return seg.replace(/-/g, " ").trim() + (seg.endsWith("?") ? "" : "?");
}

// ---------- Search results ----------

export interface SearchHit {
  title: string;
  url: string;
  snippet?: string;
}

/** Parse html.duckduckgo.com results, keeping only Quora question URLs. */
export function parseDdgResults(html: string, limit: number): SearchHit[] {
  const $ = cheerio.load(html);
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  $(".result").each((_, el) => {
    const a = $(el).find("a.result__a").first();
    let href = a.attr("href") ?? "";
    if (href.startsWith("//")) href = `https:${href}`;
    try {
      const u = new URL(href, "https://duckduckgo.com");
      const real = u.searchParams.get("uddg");
      if (real) href = real;
    } catch {
      /* keep */
    }
    const q = normalizeQuestionUrl(href);
    if (!q || seen.has(q)) return;
    seen.add(q);
    const title = clean(a.text()).replace(/\s+-\s+Quora$/i, "") || slugToTitle(q);
    const snippet = clean($(el).find(".result__snippet").text()) || undefined;
    out.push({ title, url: q, snippet });
  });
  return out.slice(0, limit);
}

/** Parse a logged-in quora.com/search page. Uses URL shape, not class names (they churn). */
export function parseQuoraSearch(html: string, pageUrl: string, limit: number): SearchHit[] {
  const $ = cheerio.load(html);
  const out: SearchHit[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const q = normalizeQuestionUrl(resolveUrl($(el).attr("href"), pageUrl) ?? "");
    if (!q || seen.has(q)) return;
    const title = clean($(el).text());
    if (title.length < 10) return; // skip icon/"more" links
    seen.add(q);
    out.push({ title, url: q });
  });
  return out.slice(0, limit);
}

// ---------- Question page ----------

export interface Answer {
  author?: string;
  authorUrl?: string;
  credential?: string;
  upvotes?: number;
  date?: string;
  url?: string;
  text: string;
}

export interface Question {
  url: string;
  title: string;
  details?: string;
  answerCount?: number;
  answers: Answer[];
  source: "json-ld" | "dom";
  warnings: string[];
}

// JSON-LD is untrusted page data, so it is read as `unknown` and narrowed field by field.
type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const asString = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

function asNumber(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function findQaPage(node: unknown): JsonObject | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findQaPage(n);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  if (asArray(node["@type"]).includes("QAPage")) return node;
  return findQaPage(node["@graph"]);
}

function ldAnswer(a: unknown, maxChars: number): Answer | null {
  if (!isObject(a)) return null;
  const text = htmlToText(asString(a.text) ?? "");
  if (!text) return null;
  const author = asArray(a.author).find(isObject);
  return {
    author: asString(author?.name),
    authorUrl: asString(author?.url),
    upvotes: asNumber(a.upvoteCount),
    date: asString(a.dateCreated),
    url: asString(a.url),
    text: truncate(text, maxChars),
  };
}

export function parseQuestionPage(html: string, url: string, maxAnswers: number, maxChars: number): Question {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const ogTitle = clean($('meta[property="og:title"]').attr("content")).replace(/\s+-\s+Quora$/i, "");

  // 1) JSON-LD (structured, most stable when present)
  let qa: JsonObject | null = null;
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      qa = findQaPage(JSON.parse($(el).text()));
    } catch {
      // Malformed JSON-LD block: try the next one.
    }
    if (qa) break;
  }

  const main = qa?.mainEntity;
  if (isObject(main)) {
    const answers = [...asArray(main.acceptedAnswer), ...asArray(main.suggestedAnswer)]
      .map((a) => ldAnswer(a, maxChars))
      .filter((a) => a !== null);
    if (answers.length) {
      const details = htmlToText(asString(main.text) ?? "");
      return {
        url,
        title: clean(asString(main.name)) || ogTitle || slugToTitle(url),
        details: details ? truncate(details, maxChars) : undefined,
        answerCount: asNumber(main.answerCount),
        answers: answers.slice(0, maxAnswers),
        source: "json-ld",
        warnings,
      };
    }
  }

  // 2) DOM fallback (heuristic)
  const title = ogTitle || clean($("h1").first().text()) || slugToTitle(url);
  let blocks = $('[class*="dom_annotate_question_answer_item"]');
  if (!blocks.length) blocks = $('[class*="AnswerBase"], .spacing_log_answer_content').parent();
  const answers: Answer[] = [];
  blocks.each((_, el) => {
    if (answers.length >= maxAnswers) return false;
    const b = $(el);
    const authorA = b
      .find('a[href*="/profile/"]')
      .filter((_, a) => clean($(a).text()).length > 0)
      .first();
    // The answer body is the largest text container inside the block
    let best = "";
    b.find('.q-text, [class*="answer_content"], p').each((_, t) => {
      const s = clean($(t).text());
      if (s.length > best.length) best = s;
    });
    if (best.length < 20) return;
    const upv = clean(b.find('[aria-label*="pvote"], button:contains("Upvote")').first().text()).match(
      /[\d.,]+[KkMm]?/,
    );
    answers.push({
      author: clean(authorA.text()) || undefined,
      authorUrl: resolveUrl(authorA.attr("href"), url) ?? undefined,
      upvotes: upv ? parseCount(upv[0]) : undefined,
      text: truncate(best, maxChars),
    });
  });

  if (!answers.length) {
    warnings.push(
      looksLikeLoginWall($)
        ? "Quora showed a login wall / bot check. Set QUORA_COOKIE or retry later."
        : "No answers found. The page layout may have changed or the question has no answers.",
    );
  }
  return { url, title, answers, source: "dom", warnings };
}

function looksLikeLoginWall($: cheerio.CheerioAPI): boolean {
  const t = $("body").text().toLowerCase();
  return (
    t.includes("continue with google") ||
    t.includes("sign in to") ||
    t.includes("verify you are human") ||
    t.includes("lanjutkan dengan google")
  );
}

// ---------- Profile ----------

export interface Profile {
  url: string;
  name: string;
  credential?: string;
  bio?: string;
  stats: Record<string, number>;
  warnings: string[];
}

/** Body text with a space between every text node (cheerio .text() glues adjacent elements). */
function spacedText($: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  $("body")
    .find("*")
    .addBack()
    .contents()
    .each((_, n) => {
      if (n.type === "text") parts.push(n.data);
    });
  return clean(parts.join(" ").replace(/\s+/g, " "));
}

export function parseCount(s: string): number {
  const m = s
    .trim()
    .replace(/,/g, "")
    .match(/^([\d.]+)\s*(rb|jt|[KkMm])?/);
  if (!m) return NaN;
  const n = Number.parseFloat(m[1]);
  const suf = (m[2] ?? "").toLowerCase();
  if (suf === "k" || suf === "rb") return Math.round(n * 1e3);
  if (suf === "m" || suf === "jt") return Math.round(n * 1e6);
  return Math.round(n);
}

const STAT_WORDS: Record<string, string> = {
  followers: "followers",
  follower: "followers",
  pengikut: "followers",
  following: "following",
  mengikuti: "following",
  answers: "answers",
  answer: "answers",
  jawaban: "answers",
  questions: "questions",
  question: "questions",
  pertanyaan: "questions",
  posts: "posts",
  post: "posts",
  kiriman: "posts",
  "content views": "contentViews",
  "tayangan konten": "contentViews",
};

export function parseProfile(html: string, url: string): Profile {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const name =
    clean($('meta[property="og:title"]').attr("content")).replace(/\s+-\s+Quora$/i, "") ||
    clean($("h1").first().text());
  const bio = clean($('meta[property="og:description"]').attr("content")) || undefined;

  const text = spacedText($);
  const stats: Record<string, number> = {};
  const re =
    /([\d.,]+\s*(?:[KkMm]|rb|jt)?)\s+(content views|tayangan konten|followers?|following|answers?|questions?|posts?|pengikut|mengikuti|jawaban|pertanyaan|kiriman)\b/gi;
  for (const m of text.matchAll(re)) {
    const key = STAT_WORDS[m[2].toLowerCase()];
    const n = parseCount(m[1]);
    if (key && Number.isFinite(n) && stats[key] === undefined) stats[key] = n;
  }
  if (!name) warnings.push("Profile name not found — page may be blocked or the profile does not exist.");
  return { url, name, bio, stats, warnings };
}
