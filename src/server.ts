import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { createAuth, LOOPBACK_HOSTS } from "./auth.js";
import { closeBrowser } from "./browser.js";
import { config } from "./config.js";
import { buildServer } from "./tools.js";

const useSecret = config.mcpSecret !== "";

if (useSecret && config.mcpSecret.length < 24) {
  console.error("MCP_SECRET must be at least 24 chars (e.g. `openssl rand -hex 24`), or empty for local-only mode.");
  process.exit(1);
}
if (!useSecret && !LOOPBACK_HOSTS.includes(config.host) && !config.localOnly) {
  console.error(
    `MCP_SECRET is empty, so HOST must be a loopback address (127.0.0.1), not "${config.host}". ` +
      "In local Docker (port published to 127.0.0.1 only) set LOCAL_ONLY=1.",
  );
  process.exit(1);
}

const auth = createAuth(config.mcpSecret, config.port);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// Stateless Streamable HTTP: new server + transport per request.
app.post(auth.path, async (req: Request, res: Response) => {
  if (!auth.check(req)) {
    res.status(404).end();
    return;
  }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error("MCP request error:", e);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

const methodNotAllowed = (req: Request, res: Response) => {
  if (!auth.check(req)) {
    res.status(404).end();
    return;
  }
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
};
app.get(auth.path, methodNotAllowed);
app.delete(auth.path, methodNotAllowed);

const httpServer = app.listen(config.port, config.host, () => {
  const endpoint = useSecret ? "/mcp/<MCP_SECRET>" : "/mcp (local-only, no secret)";
  const search = config.quoraCookie
    ? "ON (cookie set)"
    : "OFF (quora_search disabled; clients use their own web search)";
  console.log(`quora-mcp listening on http://${config.host}:${config.port}${endpoint}`);
  console.log(`native Quora search: ${search}`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    httpServer.close();
    await closeBrowser();
    process.exit(0);
  });
}
