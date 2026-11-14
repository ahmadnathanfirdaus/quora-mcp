function int(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  port: int("PORT", 8787),
  host: process.env.HOST ?? "0.0.0.0",
  /** Secret path segment: endpoint becomes /mcp/<MCP_SECRET>. Required. */
  mcpSecret: process.env.MCP_SECRET ?? "",
  /**
   * Allow an empty MCP_SECRET on a non-loopback HOST. Only for Docker on your own machine, where the
   * port is published to 127.0.0.1 only (see docker-compose.yml). Never set this on a VPS.
   */
  localOnly: process.env.LOCAL_ONLY === "1",
  /** Optional Quora session cookie string, e.g. "m-b=xxx; m-lat=yyy". Enables native Quora search. */
  quoraCookie: process.env.QUORA_COOKIE ?? "",
  /** Optional path to a Chrome/Chromium binary (otherwise Playwright's bundled Chromium). */
  chromePath: process.env.CHROME_PATH || undefined,
  maxConcurrency: int("MAX_CONCURRENCY", 2),
  minDelayMs: int("MIN_DELAY_MS", 1500),
  navTimeoutMs: int("NAV_TIMEOUT_MS", 30000),
  cacheTtlMs: int("CACHE_TTL_MIN", 30) * 60_000,
  cacheMax: int("CACHE_MAX", 200),
  userAgent:
    process.env.USER_AGENT ??
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};
