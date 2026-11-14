import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuth } from "../src/auth.js";

const req = (host?: string, secret?: string) => ({ headers: { host }, params: secret === undefined ? {} : { secret } });

test("no secret: endpoint is /mcp and only localhost Host headers pass", () => {
  const auth = createAuth("", 8787);
  assert.equal(auth.path, "/mcp");
  assert.ok(auth.check(req("127.0.0.1:8787")));
  assert.ok(auth.check(req("localhost:8787")));
  assert.ok(auth.check(req("[::1]:8787")));
  assert.ok(!auth.check(req("evil.example:8787")), "DNS-rebinding host must be rejected");
  assert.ok(!auth.check(req("127.0.0.1:9999")), "wrong port must be rejected");
  assert.ok(!auth.check(req(undefined)));
});

test("with secret: endpoint is /mcp/:secret and the Host header is ignored", () => {
  const secret = "a".repeat(48);
  const auth = createAuth(secret, 8787);
  assert.equal(auth.path, "/mcp/:secret");
  assert.ok(auth.check(req("mcp.example.com", secret)));
  assert.ok(!auth.check(req("127.0.0.1:8787", `${secret}x`)));
  assert.ok(!auth.check(req("127.0.0.1:8787", "a".repeat(47))));
  assert.ok(!auth.check(req("127.0.0.1:8787")));
});
