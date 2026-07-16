/**
 * Ollama Web Search & Fetch Extension
 *
 * Registers two custom tools that leverage Ollama's hosted web search API:
 *   - ollama_web_search: Search the web via Ollama's API
 *   - ollama_web_fetch: Fetch content from a URL via Ollama's API
 *
 * API key configuration (checked in order):
 *   1. `~/.pi/agent/ollama-web-search.json`
 *   2. OLLAMA_API_KEY environment variable
 */

import { Type } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const API_BASE = "https://ollama.com/api";
const CONFIG_FILE = "ollama-web-search.json";

function resolveApiKey(ctx: { cwd: string; mode: string }): string | undefined {
  const agentDir = getAgentDir();
  if (!agentDir) return process.env.OLLAMA_API_KEY;
  const configPath = join(agentDir, CONFIG_FILE);
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (config?.apiKey) return config.apiKey;
    } catch { /* ignore */ }
  }
  return process.env.OLLAMA_API_KEY;
}

async function fetchOllama(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal | undefined
): Promise<Response> {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "<error reading response>");
    throw new Error(`${endpoint} failed (${res.status}): ${errText}`);
  }
  return res;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ollama_web_search",
    label: "Ollama Web Search",
    description: "Search the web using Ollama's hosted search API.",
    promptSnippet: "Search the web for information using Ollama's hosted search API.",
    promptGuidelines: [
      "Use ollama_web_search when the user asks a question requiring current or factual information.",
      "Pass a clear, concise search query.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "The search query to run" }),
      maxResults: Type.Optional(
        Type.Number({
          description: "Maximum number of results to return (default: 3)",
          minimum: 1,
          maximum: 10,
        })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const apiKey = resolveApiKey(ctx);
      const res = await fetchOllama("web_search", {
        query: params.query,
        max_results: params.maxResults ?? 3,
      }, apiKey, signal);
      const data = await res.json() as { results: Array<{ title?: string; url: string; content: string }> };
      return {
        content: [{ type: "text", text: JSON.stringify(data.results, null, 2) }],
        details: {
          query: params.query,
          maxResults: params.maxResults ?? 3,
          resultCount: data.results.length,
        },
      };
    },
    renderCall(args, theme, _ctx) {
      const q = args.query || "...";
      const count = args.maxResults ?? 3;
      return new Text(`${theme.fg("toolTitle", theme.bold("search"))} "${q}" (${count} results)`, 0, 0);
    },
    renderResult(result, { expanded }, theme, _ctx) {
      const text = result.content.find(c => c.type === "text");
      if (!text || text.type !== "text") return new Text("", 0, 0);

      const results = JSON.parse(text.text) as Array<{ title?: string; url: string; content: string }>;
      const count = results.length;

      if (!expanded) {
        const summary = results
          .map((r, i) => `${i + 1}. ${r.title ?? "No title"}`)
          .join("\n");
        return new Text(`↳ ${count} results:\n${summary}`, 0, 0);
      }

      const full = results
        .map((r, i) => `## ${i + 1}. ${r.title ?? "No title"}\nURL: ${r.url}\n${r.content}`)
        .join("\n\n");
      return new Text(`\n${full}`, 0, 0);
    },
  });

  pi.registerTool({
    name: "ollama_web_fetch",
    label: "Ollama Web Fetch",
    description: "Fetch the full content of a web page using Ollama's hosted fetch API.",
    promptSnippet: "Fetch the content of a web page for the provided URL.",
    promptGuidelines: [
      "Use ollama_web_fetch when the user provides a URL and wants its content.",
      "Only pass absolute URLs.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "The absolute URL to fetch" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const apiKey = resolveApiKey(ctx);
      const res = await fetchOllama("web_fetch", { url: params.url }, apiKey, signal);
      const data = await res.json() as { title?: string; content: string; links?: string[] };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { url: params.url },
      };
    },
    renderCall(args, theme, _ctx) {
      const u = args.url || "...";
      return new Text(`${theme.fg("toolTitle", theme.bold("fetch"))} ${u}`, 0, 0);
    },
    renderResult(result, { expanded }, theme, _ctx) {
      const text = result.content.find(c => c.type === "text");
      if (!text || text.type !== "text") return new Text("", 0, 0);

      const data = JSON.parse(text.text) as { title?: string; content: string; links?: string[] };

      if (!expanded) {
        const snippet = data.content?.slice(0, 200) || "";
        const title = data.title ? ` — ${data.title}` : "";
        return new Text(`↳${title}\n${snippet}${data.content?.length > 200 ? "..." : ""}`, 0, 0);
      }

      const parts = [
        data.title && `Title: ${data.title}`,
        `URL: ${result.details?.url}`,
        `Content: ${data.content}`,
        data.links && `Links: ${data.links.join(", ")}`,
      ].filter(Boolean);
      return new Text(`\n${parts.join("\n\n")}`, 0, 0);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!resolveApiKey(ctx)) {
      ctx.ui.notify(
        "⚠️ No Ollama API key found. Create ~/.pi/agent/ollama-web-search.json or set OLLAMA_API_KEY.",
        "warning"
      );
    }
  });
}
