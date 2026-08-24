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

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

const API_BASE = process.env.OLLAMA_API_BASE ?? "https://ollama.com/api";
const CONFIG_FILE = "ollama-web-search.json";
const DEFAULT_MAX_RESULTS = 3;

// ─── API key resolution ────────────────────────────────────────────────────

let cachedApiKey: string | undefined;

function resolveApiKey(): string | undefined {
  if (cachedApiKey !== undefined) return cachedApiKey;

  const envKey = process.env.OLLAMA_API_KEY;
  const agentDir = getAgentDir();

  if (agentDir) {
    const configPath = join(agentDir, CONFIG_FILE);
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, "utf-8");
        const config = JSON.parse(raw) as { apiKey?: string };
        if (config?.apiKey !== undefined) {
          cachedApiKey = config.apiKey;
          return config.apiKey;
        }
      } catch (e) {
        console.warn(`[ollama-web-search] failed to parse config:`, e);
      }
    }
  }
  cachedApiKey = envKey;
  return envKey;
}

// ─── HTTP layer ─────────────────────────────────────────────────────────────

interface SearchResult {
  title?: string;
  url: string;
  content: string;
}

interface FetchDetails {
  url?: string;
  title?: string;
  content?: string;
  links?: string[];
  raw?: string;
}

async function fetchOllamaRaw(
  endpoint: string,
  body: Record<string, unknown>,
  signal: AbortSignal | undefined,
): Promise<string> {
  const apiKey = resolveApiKey() ?? "";
  const url = `${API_BASE}/${endpoint}`;
  const res = await fetch(url, {
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
    throw new Error(
      `${endpoint} failed (${String(res.status)}) at ${url}: ${errText}`,
    );
  }
  return res.text();
}

// ─── Tool: ollama_web_search ───────────────────────────────────────────────

const searchParams = Type.Object({
  query: Type.String({ description: "The search query to run" }),
  maxResults: Type.Optional(
    Type.Number({
      description: `Maximum number of results to return (default: ${String(
        DEFAULT_MAX_RESULTS,
      )})`,
      minimum: 1,
      maximum: 10,
    }),
  ),
});

interface SearchDetails {
  results?: SearchResult[];
  raw?: string;
}

// ─── Tool: ollama_web_fetch ─────────────────────────────────────────────────

const fetchParams = Type.Object({
  url: Type.String({
    description: "The absolute URL to fetch",
    format: "uri",
  }),
});

// ─── Extension registration ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool<typeof searchParams, SearchDetails, never>({
    name: "ollama_web_search",
    label: "Ollama Web Search",
    description: "Search the web using Ollama's hosted search API.",
    promptSnippet:
      "Search the web for information using Ollama's hosted search API.",
    promptGuidelines: [
      "Use ollama_web_search when the user asks a question requiring current or factual information.",
      "Pass a clear, concise search query.",
    ],
    parameters: searchParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const maxResults = params.maxResults ?? DEFAULT_MAX_RESULTS;
      const raw = await fetchOllamaRaw(
        "web_search",
        { query: params.query, max_results: maxResults },
        signal,
      );
      const text = raw.trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          content: [{ type: "text", text }],
          details: { raw: text },
        };
      }
      const results = (parsed as { results?: SearchResult[] }).results ?? [];
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        details: { results },
      };
    },

    renderCall(args, theme, _ctx) {
      const maxResults =
        args.maxResults !== undefined ? args.maxResults : DEFAULT_MAX_RESULTS;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("search"))} "${
          args.query ?? "..."
        }" (${String(maxResults)} results)`,
      );
    },

    renderResult(result, { expanded }, _theme, _ctx) {
      const details = result.details as SearchDetails;
      if (details.raw !== undefined) {
        return new Text(`Raw response:\n${details.raw}`, 0, 0);
      }
      const results = details.results ?? [];
      const count = results.length;

      if (!expanded) {
        const summary = results
          .map((r, i) => `${String(i + 1)}. ${r.title ?? "No title"}`)
          .join("\n");
        return new Text(`↳ ${String(count)} results:\n${summary}`, 0, 0);
      }

      const full = results
        .map(
          (r, i) =>
            `## ${String(i + 1)}. ${r.title ?? "No title"}\nURL: ${r.url}\n${r.content}`,
        )
        .join("\n\n");
      return new Text(`\n${full}`, 0, 0);
    },
  });

  pi.registerTool<typeof fetchParams, FetchDetails, never>({
    name: "ollama_web_fetch",
    label: "Ollama Web Fetch",
    description:
      "Fetch the full content of a web page using Ollama's hosted fetch API.",
    promptSnippet: "Fetch the content of a web page for the provided URL.",
    promptGuidelines: [
      "Use ollama_web_fetch when the user provides a URL and wants its content.",
      "Only pass absolute URLs.",
    ],
    parameters: fetchParams,

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const validatedUrl = new URL(params.url).href;
      const raw = await fetchOllamaRaw(
        "web_fetch",
        { url: validatedUrl },
        signal,
      );
      const text = raw.trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return {
          content: [{ type: "text", text }],
          details: { raw: text },
        };
      }
      const data = parsed as Omit<FetchDetails, "raw">;
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { ...data, url: validatedUrl },
      };
    },

    renderCall(args, theme, _ctx) {
      return new Text(
        `${theme.fg("toolTitle", theme.bold("fetch"))} ${args.url}`,
      );
    },

    renderResult(result, { expanded }, _theme, _ctx) {
      if (result.details.raw !== undefined) {
        return new Text(`Raw response:\n${result.details.raw}`, 0, 0);
      }
      const details = result.details as FetchDetails;
      const { title, links } = details;
      const contentStr = details.content ?? "";
      const url = details.url ?? "unknown";

      if (!expanded) {
        const snippet = contentStr.slice(0, 200);
        return new Text(
          `↳${title ? ` — ${title}` : ""}\n${snippet}${
            contentStr.length > 200 ? "..." : ""
          }`,
          0,
          0,
        );
      }

      const parts = [
        title && `Title: ${title}`,
        `URL: ${url}`,
        `Content: ${contentStr}`,
        links && `Links: ${links.join(", ")}`,
      ].filter(Boolean);
      return new Text(`\n${parts.join("\n\n")}`, 0, 0);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!resolveApiKey()) {
      ctx.ui.notify(
        "⚠️ No Ollama API key found. Create ~/.pi/agent/ollama-web-search.json or set OLLAMA_API_KEY.",
        "warning",
      );
    }
  });
}
