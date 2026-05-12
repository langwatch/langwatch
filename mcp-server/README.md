# LangWatch MCP Server

MCP server that gives AI coding agents access to LangWatch observability data, prompts, datasets, scenarios, evaluators, and documentation via the [Model Context Protocol](https://modelcontextprotocol.io/introduction).

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
| `platform_list_prompts` | List all prompts |
| `platform_get_prompt` | Get prompt with messages and version history |
| `platform_create_prompt` | Create a new prompt |
| `platform_update_prompt` | Update prompt or create new version |

### Datasets (requires API key)

| Tool | Description |
|------|-------------|
| `platform_list_datasets` | List all datasets with record counts |
| `platform_get_dataset` | Get dataset metadata, columns, and record preview |
| `platform_create_dataset` | Create a new dataset with optional column definitions |
| `platform_update_dataset` | Update dataset name or column types |
| `platform_delete_dataset` | Archive a dataset |
| `platform_create_dataset_records` | Add records to a dataset (max 1000 per call) |
| `platform_update_dataset_record` | Update a single record |
| `platform_delete_dataset_records` | Delete records by IDs (max 1000 per call) |

### Scenarios (requires API key)

| Tool | Description |
|------|-------------|
| `platform_list_scenarios` | List all scenarios |
| `platform_get_scenario` | Get scenario details |
| `platform_create_scenario` | Create a new scenario |
| `platform_update_scenario` | Update a scenario |
| `platform_archive_scenario` | Archive a scenario |

### Evaluators (requires API key)

| Tool | Description |
|------|-------------|
| `platform_list_evaluators` | List all evaluators |
| `platform_get_evaluator` | Get evaluator details |
| `platform_create_evaluator` | Create a new evaluator |
| `platform_update_evaluator` | Update an evaluator |

### Model Providers (requires API key)

| Tool | Description |
|------|-------------|
| `platform_list_model_providers` | List configured model providers |
| `platform_set_model_provider` | Configure a model provider |

## Output Formats

Several tools support a `format` parameter:

- **`digest`** (default) — AI-readable markdown output. Optimized for LLM consumption — compact and information-dense.
- **`json`** — Full raw data. Useful for programmatic access or when you need the complete schema.

Supported on: `search_traces`, `get_trace`, `platform_list_datasets`, `platform_get_dataset`, `platform_list_scenarios`, `platform_get_scenario`.

## Usage Tips

- Start with `discover_schema` to understand available filter fields and metrics.
- Use `search_traces` to find relevant traces, then `get_trace` for full details.
- Search returns 25 traces per page by default. Use `scrollId` from the response to paginate.
- Analytics uses `category.name` format for metrics (e.g., `performance.completion_time`).
- Use `create_prompt` / `update_prompt` with `createVersion: true` for safe prompt iteration.
- Use `platform_list_datasets` then `platform_get_dataset` to browse dataset contents.
- Dataset tools support full CRUD: create datasets, add/update/delete records, and archive datasets.

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
