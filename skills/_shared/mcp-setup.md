# Installing the LangWatch MCP

## For Claude Code
Run:
```bash
claude mcp add langwatch -- npx -y @langwatch/mcp-server --apiKey YOUR_API_KEY
```

Or add to `~/.claude.json` or `.mcp.json` in the project:
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

## For other editors
Add to your editor's MCP settings file using the JSON config above.

**Tip:** If `LANGWATCH_API_KEY` is already in the project's `.env` file, use that same key for the MCP configuration.
