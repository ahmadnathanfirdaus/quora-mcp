import { stripVTControlCharacters } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from "./config.js";
import { getProfile, getQuestion, search } from "./quora.js";

/** Builds the MCP server with Quora tools. A fresh one is created per HTTP request (stateless transport). */
export function buildServer(): McpServer {
  // Without a Quora cookie there is no reliable way to search from this server (scraped search
  // engines block bots or are DNS-blocked), so finding questions is delegated to the client's web search.
  const nativeSearch = config.quoraCookie !== "";
  const instructions = [
    "Read-only access to Quora pages.",
    nativeSearch
      ? "To find questions, use quora_search."
      : "This server cannot search. To find Quora questions, use your own web search tool with a query like " +
        "'site:quora.com <keywords>' (or 'site:id.quora.com <keywords>' for Indonesian), then pass the question URLs " +
        "to quora_get_question.",
    "Use quora_get_profile for a user's public profile.",
  ].join(" ");
  const server = new McpServer({ name: "quora-reader", version: "1.0.0" }, { instructions });

  const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
  const fail = (e: unknown) => {
    // Playwright errors carry ANSI colors and a long "Call log"; keep only the message itself.
    const message = stripVTControlCharacters(e instanceof Error ? e.message : String(e))
      .split("\nCall log:")[0]
      .trim();
    return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
  };
  const readOnly = { readOnlyHint: true, openWorldHint: true, idempotentHint: true };

  if (nativeSearch)
    server.registerTool(
      "quora_search",
      {
        title: "Search Quora questions",
        description:
          "Search Quora for questions. Returns question titles and URLs. Use lang='id' for Indonesian Quora (id.quora.com). " +
          "Pass a returned URL to quora_get_question to read the answers.",
        inputSchema: {
          query: z.string().min(2).describe("Search keywords"),
          limit: z.number().int().min(1).max(25).default(10),
          lang: z
            .enum(["any", "en", "id"])
            .default("any")
            .describe("any = all Quora sites, en = www.quora.com, id = id.quora.com"),
        },
        annotations: readOnly,
      },
      async ({ query, limit, lang }) => {
        try {
          return ok(await search(query, limit, lang));
        } catch (e) {
          return fail(e);
        }
      },
    );

  server.registerTool(
    "quora_get_question",
    {
      title: "Read a Quora question and its answers",
      description:
        "Fetch a Quora question page (or an answer URL) and return the question plus top answers with author and upvotes." +
        (nativeSearch ? "" : " To find question URLs, run a web search for 'site:quora.com <keywords>' first."),
      inputSchema: {
        url: z.string().url().describe("Quora question or answer URL"),
        max_answers: z.number().int().min(1).max(30).default(8),
        max_chars_per_answer: z.number().int().min(200).max(20000).default(3000),
      },
      annotations: readOnly,
    },
    async ({ url, max_answers, max_chars_per_answer }) => {
      try {
        return ok(await getQuestion(url, max_answers, max_chars_per_answer));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "quora_get_profile",
    {
      title: "Read a Quora profile",
      description: "Fetch a Quora user's public profile: name, bio/credential, follower/answer counts.",
      inputSchema: {
        user: z
          .string()
          .min(2)
          .describe("Profile URL (https://www.quora.com/profile/Name) or profile slug like 'Jane-Doe-12'"),
      },
      annotations: readOnly,
    },
    async ({ user }) => {
      try {
        return ok(await getProfile(user));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
