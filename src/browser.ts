import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { config } from "./config.js";
import { sleep } from "./util.js";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let starting: Promise<BrowserContext> | null = null;

function parseCookieString(s: string) {
  return s
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p.includes("="))
    .map((p) => {
      const i = p.indexOf("=");
      return {
        name: p.slice(0, i).trim(),
        value: p.slice(i + 1).trim(),
        domain: ".quora.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "Lax" as const,
      };
    });
}

async function start(): Promise<BrowserContext> {
  browser = await chromium.launch({
    headless: true,
    executablePath: config.chromePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  });
  browser.on("disconnected", () => {
    browser = null;
    context = null;
  });
  const ctx = await browser.newContext({
    userAgent: config.userAgent,
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
  });
  if (config.quoraCookie) await ctx.addCookies(parseCookieString(config.quoraCookie));
  // Save bandwidth/RAM: no images, media, fonts.
  await ctx.route("**/*", (route) => {
    const t = route.request().resourceType();
    return t === "image" || t === "media" || t === "font" ? route.abort() : route.continue();
  });
  context = ctx;
  return ctx;
}

export async function getContext(): Promise<BrowserContext> {
  if (context && browser?.isConnected()) return context;
  if (!starting)
    starting = start().finally(() => {
      starting = null;
    });
  return starting;
}

export interface LoadOptions {
  /** Scroll this many times to trigger lazy-loaded content. */
  scrolls?: number;
  /** Click "(more)" / "Continue Reading" expanders. */
  expand?: boolean;
}

/** Load a page in headless Chromium and return the rendered HTML. */
export async function loadHtml(
  url: string,
  opts: LoadOptions = {},
): Promise<{ html: string; finalUrl: string; status: number }> {
  const ctx = await getContext();
  const page: Page = await ctx.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.navTimeoutMs });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < (opts.scrolls ?? 0); i++) {
      await page.mouse.wheel(0, 4000);
      await sleep(900);
    }
    if (opts.expand) await expandTruncated(page);
    return { html: await page.content(), finalUrl: page.url(), status: resp?.status() ?? 0 };
  } finally {
    await page.close().catch(() => {});
  }
}

async function expandTruncated(page: Page) {
  const loc = page.locator("text=/^\\(more\\)$|^Continue Reading$|^Lanjutkan Membaca$|^\\(selengkapnya\\)$/i");
  const n = Math.min(await loc.count().catch(() => 0), 15);
  for (let i = 0; i < n; i++) {
    await loc
      .nth(i)
      .click({ timeout: 1500 })
      .catch(() => {});
    await sleep(150);
  }
  if (n) await sleep(600);
}

export async function closeBrowser() {
  await browser?.close().catch(() => {});
}
