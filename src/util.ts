import * as cheerio from "cheerio";

/** Simple semaphore + minimum spacing between task starts (politeness / anti-ban). */
export class Throttle {
  private active = 0;
  private queue: Array<() => void> = [];
  /** Earliest time the next task may start. Reserved synchronously, so concurrent callers queue up behind each other. */
  private nextStart = 0;

  constructor(
    private max: number,
    private minDelayMs: number,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      const now = Date.now();
      const start = Math.max(now, this.nextStart);
      this.nextStart = start + this.minDelayMs;
      if (start > now) await sleep(start - now);
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((res) =>
      this.queue.push(() => {
        this.active++;
        res();
      }),
    );
  }

  private release() {
    this.active--;
    this.queue.shift()?.();
  }
}

export class TtlCache<V> {
  private map = new Map<string, { v: V; exp: number }>();
  constructor(
    private ttlMs: number,
    private max: number,
  ) {}

  get(k: string): V | undefined {
    const e = this.map.get(k);
    if (!e) return undefined;
    if (e.exp < Date.now()) {
      this.map.delete(k);
      return undefined;
    }
    this.map.delete(k);
    this.map.set(k, e); // LRU bump
    return e.v;
  }

  set(k: string, v: V) {
    this.map.delete(k);
    this.map.set(k, { v, exp: Date.now() + this.ttlMs });
    // Map iterates in insertion order, so the first key is the least recently used.
    for (const oldest of this.map.keys()) {
      if (this.map.size <= this.max) break;
      this.map.delete(oldest);
    }
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clean(s: string | undefined | null): string {
  return (s ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [truncated]` : s;
}

/** HTML fragment to plain text (JSON-LD answer text is HTML). Keeps paragraph breaks, decodes all entities. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html, null, false);
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6").append("\n");
  return clean($.root().text());
}
