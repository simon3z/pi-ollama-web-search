# PI Assistant Ollama Web Search Extension

[![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat&colorA=333333)](https://github.com/simon3z/pi-ollama-web-search/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-6FB2F7?style=flat&colorA=333333)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-007AB8?style=flat&logo=typescript&logoColor=white&colorA=333333)](https://www.typescriptlang.org/)
[![pi coding agent extension](https://img.shields.io/badge/pi-extension-orange?style=flat&colorA=333333)](https://pi.dev)

A [pi coding agent](https://pi.dev) extension that adds web search and web fetch capabilities via Ollama's hosted API.

## Why This Project

Many alternatives require a running local Ollama instance with web search enabled. This extension targets Ollama's hosted API instead — an API key is all you need, no local server setup.

It also adds rich TUI rendering so results are nicely formatted in the pi terminal UI, with compact summaries that expand to full detail. Configuration uses a discoverable config file (`~/.pi/agent/ollama-web-search.json`) with the env var as fallback.

Finally, it's intentionally a single-file extension — easy to read, fork, and modify.

![demo](demo.gif)

## Tools

| Tool | Description |
|------|-------------|
| `ollama_web_search` | Search the web using Ollama's hosted search API |
| `ollama_web_fetch` | Fetch the content of a web page via Ollama's hosted fetch API |

## Quick Start

```bash
# Clone this repo
git clone https://github.com/simon3z/pi-ollama-web-search

# Load the extension
pi -e ./index.ts
```

Or install it as a pi package:

```bash
pi install git:github.com/simon3z/pi-ollama-web-search
```

Then it auto-loads in every session.

## Configuration

Create **`~/.pi/agent/ollama-web-search.json`** with your API key:

```json
{
  "apiKey": "sk-..."
}
```

### Legacy fallback

The `OLLAMA_API_KEY` environment variable is still supported as a fallback.

## Requirements

- Ollama API key (get one from [ollama.com](https://ollama.com))
