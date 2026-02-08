# LangWatch MCP Server

MCP server that gives AI coding agents access to LangWatch observability data, prompts, and documentation via the [Model Context Protocol](https://modelcontextprotocol.io/introduction).

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

For Claude Code, you can also run:

```bash
claude mcp add langwatch -- npx -y @langwatch/mcp-server --apiKey your-api-key-here
```

The API key is required for observability and prompt tools. Documentation tools work without it.

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
| `search_traces` | Search traces with filters, text query, and date range |
| `get_trace` | Get full trace details with AI-readable formatting |
| `get_analytics` | Query timeseries analytics data |

### Prompts (requires API key)

| Tool | Description |
|------|-------------|
| `list_prompts` | List all prompts |
| `get_prompt` | Get prompt with messages and version history |
| `create_prompt` | Create a new prompt |
| `update_prompt` | Update prompt or create new version |

## Output Formats

The `search_traces` and `get_trace` tools support a `format` parameter:

- **`digest`** (default) — AI-readable trace digest with hierarchical span tree, timing, inputs/outputs, and errors. Optimized for LLM consumption — compact and information-dense.
- **`json`** — Full raw trace data with all fields. Useful for programmatic access or when you need the complete schema.

## Usage Tips

- Start with `discover_schema` to understand available filter fields and metrics.
- Use `search_traces` to find relevant traces, then `get_trace` for full details.
- Search returns 25 traces per page by default. Use `scrollId` from the response to paginate.
- Analytics uses `category.name` format for metrics (e.g., `performance.completion_time`).
- Use `create_prompt` / `update_prompt` with `createVersion: true` for safe prompt iteration.

## Development

### Prerequisites

- Node.js 18+
- pnpm

### Setup

```bash
pnpm install
```

### Build

```bash
pnpm build
```

### Test

```bash
pnpm test        # Run all tests
pnpm test:unit   # Unit tests only
```

### Local testing

Build and point your MCP client to the local dist:

```json
{
  "mcpServers": {
    "langwatch": {
      "command": "node",
      "args": [
        "/path/to/mcp-server/dist/index.js",
        "--apiKey", "your-api-key",
        "--endpoint", "http://localhost:5560"
      ]
    }
  }
}
```

## Support

- [Discord Community](https://discord.gg/kT4PhDS2gH)
- [LangWatch Docs](https://langwatch.ai/docs)
- [Email Support](mailto:support@langwatch.ai)
