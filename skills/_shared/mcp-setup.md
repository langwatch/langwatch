# Installing the LangWatch MCP Server

## Claude Code

Run:
```bash
claude mcp add langwatch -- npx -y @langwatch/mcp-server --apiKey YOUR_API_KEY
```

Or add to `.mcp.json` (project-level) or `~/.claude.json` (global):
```json
{
  "mcpServers": {
    "langwatch": {
      "command": "npx",
      "args": ["-y", "@langwatch/mcp-server"],
      "env": {
        "LANGWATCH_API_KEY": "YOUR_API_KEY"
      }
    }
  }
}
```

## Other Editors

Add the JSON config above to your editor's MCP settings file.

The API key can be set via `LANGWATCH_API_KEY` env var or `--apiKey` flag.
Use `LANGWATCH_ENDPOINT` / `--endpoint` to override the default endpoint (`https://app.langwatch.ai`).
