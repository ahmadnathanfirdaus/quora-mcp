import { timingSafeEqual } from "node:crypto";

export const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1"];

/** The parts of an Express request that auth looks at (kept minimal so tests can pass plain objects). */
export interface AuthRequest {
  params: Record<string, unknown>;
  headers: { host?: string };
}

export interface Auth {
  /** Express route for the MCP endpoint. */
  path: string;
  check(req: AuthRequest): boolean;
}

/**
 * With a secret, the endpoint is /mcp/<secret> (constant-time compare).
 * Without one, it is /mcp and only accepts a localhost Host header, which blocks DNS rebinding from web pages.
 */
export function createAuth(secret: string, port: number): Auth {
  if (secret) {
    const expected = Buffer.from(secret);
    return {
      path: "/mcp/:secret",
      check(req) {
        const got = Buffer.from(String(req.params.secret ?? ""));
        return got.length === expected.length && timingSafeEqual(got, expected);
      },
    };
  }
  const allowed = new Set(LOOPBACK_HOSTS.map((h) => (h.includes(":") ? `[${h}]:${port}` : `${h}:${port}`)));
  return {
    path: "/mcp",
    check: (req) => allowed.has(req.headers.host ?? ""),
  };
}
