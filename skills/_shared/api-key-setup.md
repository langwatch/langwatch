# LangWatch API Key Setup

1. Check if `LANGWATCH_API_KEY` is already set in your environment or `.env` file.
2. If missing, get one at: https://app.langwatch.ai/authorize
3. Add it to your project's `.env` file (check for duplicates first):
```
LANGWATCH_API_KEY=sk-lw-...
```
4. The MCP server also needs the key -- pass it via `--apiKey` flag or `LANGWATCH_API_KEY` env var.

See [MCP Setup](mcp-setup.md) for full server configuration.
