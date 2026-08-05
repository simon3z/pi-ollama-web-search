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
import { Container, Text } from "@earendil-works/pi-tui";

const API_BASE = process.env.OLLAMA_API_BASE ?? "https://ollama.com/api";
const CONFIG_FILE = "ollama-web-search.json";
const DEFAULT_MAX_RESULTS = 3;

let cachedApiKey: string | undefined;

function resolveApiKey(_ctx: {
  cwd: string;
  mode: string;
}): string | undefined {
  if (cachedApiKey !== undefined) return cachedApiKey;

  const agentDir = getAgentDir();
  const envKey = process.env.OLLAMA_API_KEY;

  if (!agentDir) return envKey;
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

  cachedApiKey = envKey;
  return envKey;
}

function parseResultContent(result: {
  content?: Array<{ type: string; text?: string }>;
}): { raw: string; parsed: unknown } | null {
  const textItem = result.content?.find((item) => item.type === "text");
  if (!textItem || typeof textItem.text !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(textItem.text);
  } catch {
    return { raw: textItem.text, parsed: undefined };
  }
  return { raw: textItem.text, parsed };
}

async function fetchOllama(
  endpoint: string,
  body: Record<string, unknown>,
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<Response> {
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
  return res;
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ollama_web_search",
    label: "Ollama Web Search",
    description: "Search the web using Ollama's hosted search API.",
    promptSnippet:
      "Search the web for information using Ollama's hosted search API.",
    promptGuidelines: [
      "Use ollama_web_search when the user asks a question requiring current or factual information.",
      "Pass a clear, concise search query.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "The search query to run" }),
      maxResults: Type.Optional(
        Type.Number({
          description: `Maximum number of results to return (default: ${String(DEFAULT_MAX_RESULTS)})`,
          minimum: 1,
          maximum: 10,
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const apiKey = resolveApiKey(ctx) ?? "";
      const res = await fetchOllama(
        "web_search",
        {
          query: params.query,
          max_results: params.maxResults ?? DEFAULT_MAX_RESULTS,
        },
        apiKey,
        signal,
      );
      const fetchResponse = (await res.json()) as {
        results: Array<{ title?: string; url: string; content: string }>;
      };
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(fetchResponse.results, null, 2),
          },
        ],
        details: {
          query: params.query,
          maxResults: params.maxResults ?? DEFAULT_MAX_RESULTS,
          resultCount: fetchResponse.results.length,
        },
      };
    },

    renderCall(args, theme, _ctx) {
      const maxResults =
        args.maxResults !== undefined ? args.maxResults : DEFAULT_MAX_RESULTS;
      return new Text(
        `${theme.fg("toolTitle", theme.bold("search"))} "${args.query ?? "..."}" (${String(maxResults)} results)`,
      );
    },

    renderResult(result, { expanded }, _theme, _ctx) {
      const data = parseResultContent(result);
      if (!data) return new Container();
      const parsed = data.parsed;
      if (typeof parsed === "undefined") {
        return new Text(`Raw response:\n${data.raw}`, 0, 0);
      }

      const results = parsed as Array<{
        title?: string;
        url: string;
        content: string;
      }>;
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

  pi.registerTool({
    name: "ollama_web_fetch",
    label: "Ollama Web Fetch",
    description:
      "Fetch the full content of a web page using Ollama's hosted fetch API.",
    promptSnippet: "Fetch the content of a web page for the provided URL.",
    promptGuidelines: [
      "Use ollama_web_fetch when the user provides a URL and wants its content.",
      "Only pass absolute URLs.",
    ],
    parameters: Type.Object({
      url: Type.String({
        description: "The absolute URL to fetch",
        format: "uri",
      }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Validate URL locally so we give a clear error before hitting the API
      const validatedUrl = new URL(params.url).href;
      const apiKey = resolveApiKey(ctx) ?? "";
      const res = await fetchOllama(
        "web_fetch",
        { url: validatedUrl },
        apiKey,
        signal,
      );
      const data = (await res.json()) as {
        title?: string;
        content?: string;
        links?: string[];
      };
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { url: params.url },
      };
    },

    renderCall(args, theme, _ctx) {
      const url = args.url as string;
      return new Text(`${theme.fg("toolTitle", theme.bold("fetch"))} ${url}`);
    },

    renderResult(result, { expanded }, _theme, _ctx) {
      const data = parseResultContent(result);
      if (!data) return new Container();
      const parsed = data.parsed;
      if (typeof parsed === "undefined") {
        return new Text(`Raw response:\n${data.raw}`, 0, 0);
      }

      const content = parsed as {
        title?: string;
        content?: string;
        links?: string[];
      };

      if (!expanded) {
        const snippet = (content.content ?? "").slice(0, 200);
        const title = content.title ? ` — ${content.title}` : "";
        return new Text(
          `↳${title}\n${snippet}${(content.content ?? "").length > 200 ? "..." : ""}`,
          0,
          0,
        );
      }

      const detailsUrl = (result as { details?: { url: string } }).details?.url;
      const contentStr = content.content ?? "";
      const parts = [
        content.title && `Title: ${content.title}`,
        `URL: ${detailsUrl || "unknown"}`,
        `Content: ${contentStr}`,
        content.links && `Links: ${content.links.join(", ")}`,
      ].filter(Boolean);
      return new Text(`\n${parts.join("\n\n")}`, 0, 0);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (!resolveApiKey(ctx)) {
      ctx.ui.notify(
        "⚠️ No Ollama API key found. Create ~/.pi/agent/ollama-web-search.json or set OLLAMA_API_KEY.",
        "warning",
      );
    }
  });
}
