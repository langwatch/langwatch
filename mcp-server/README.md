# LangWatch MCP Server

MCP server that gives AI coding agents access to LangWatch observability data, prompts, and documentation.

## Quick Setup

Add to your MCP client configuration (Claude Code, Cursor, etc.):

```json
{
  "mcpServers": {
    "langwatch": {
      "command": "npx",
      "args": ["-y", "@langwatch/mcp-server"],
      "env": {
        "LANGWATCH_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

The API key is only required for observability and prompt tools. Documentation tools work without it.

## Configuration

| Env Var | CLI Arg | Description |
|---------|---------|-------------|
| `LANGWATCH_API_KEY` | `--apiKey` | API key for authentication |
| `LANGWATCH_ENDPOINT` | `--endpoint` | API endpoint (default: `https://app.langwatch.ai`) |

## Tools

### Documentation

| Tool | Description |
|------|-------------|
| `fetch_langwatch_docs` | Fetch LangWatch integration docs |
| `fetch_scenario_docs` | Fetch Scenario agent testing docs |

### Observability (requires API key)

| Tool | Description |
|------|-------------|
| `discover_schema` | Explore available filters, metrics, aggregations, and groups |
| `search_traces` | Search traces with filters and text query |
| `get_trace` | Get full trace details with AI-readable formatting |
| `get_analytics` | Query timeseries analytics data |

### Prompts (requires API key)

| Tool | Description |
|------|-------------|
| `list_prompts` | List all prompts |
| `get_prompt` | Get prompt with messages and version history |
| `create_prompt` | Create a new prompt |
| `update_prompt` | Update prompt or create new version |

## Usage Tips

- Start with `discover_schema` to understand available filter fields and metrics.
- Use `search_traces` to find relevant traces, then `get_trace` for details.
- Analytics uses `category.name` format for metrics (e.g., `performance.completion_time`).

## Support

- [Discord Community](https://discord.gg/kT4PhDS2gH)
- [LangWatch Docs](https://langwatch.ai/docs)
- [Email Support](mailto:support@langwatch.ai)
