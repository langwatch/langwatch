# Installing the LangWatch MCP

## For Claude Code
Run:
```bash
claude mcp add langwatch -- npx -y @langwatch/mcp-server --apiKey YOUR_API_KEY
```

Or add an entry named `langwatch` under the `mcpServers` object of `~/.claude.json` or `.mcp.json` with these fields:
- `command`: npx
- `args`: `-y`, then the package name on a separate token
- package to launch: the npm package `@langwatch/mcp-server` (scoped)
- `env.LANGWATCH_API_KEY`: the user's LangWatch API key

## For other editors
Add the same `mcpServers.langwatch` entry to your editor's MCP settings file. Use the fields listed above.

## For ChatGPT, Claude Chat, or other web assistants
Use the hosted remote MCP server:
- URL: `https://mcp.langwatch.ai/sse`
- Authentication: Bearer Token with your LangWatch API key
- Get a key at https://app.langwatch.ai/authorize

**Tip:** If `LANGWATCH_API_KEY` is already in the project's `.env` file, use that same key for the MCP configuration.
