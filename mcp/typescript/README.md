# LangWatch MCP Server

MCP server that gives AI coding agents access to LangWatch observability data, prompts, datasets, scenarios, evaluators, and documentation via the [Model Context Protocol](https://modelcontextprotocol.io/introduction).

## Quick Setup

For Claude Code, run:

```bash
claude mcp add langwatch -- npx -y @langwatch/mcp-server --apiKey your-api-key-here
```

For Claude Code (manual) or other MCP clients (Cursor, Copilot, etc.), add an entry named `langwatch` under the `mcpServers` object of your client's MCP settings file with these fields:

- `command`: `npx`
- `args`: `-y`, then the package name `@langwatch/mcp-server` on a separate token
- `env.LANGWATCH_API_KEY`: your LangWatch API key

In stdio mode the API key is required for observability and prompt tools, and documentation tools work without it. In HTTP mode every MCP request needs a valid key, including documentation-tool requests, because the server authenticates the request before it reaches any tool.

> The config is described in prose rather than as a JSON snippet because some CLI agents (notably Gemini CLI 0.36.0 and earlier) parse `@`-prefixed runs as file paths and can crash with `ENAMETOOLONG` when a multi-line JSON snippet wraps the scoped package name in double quotes. See [#3104](https://github.com/langwatch/langwatch/issues/3104). The bash form above is safe — the package name is followed by a whitespace terminator.

## Configuration

| Env Var                         | CLI Arg           | Description                                                |
| ------------------------------- | ----------------- | ---------------------------------------------------------- |
| `LANGWATCH_API_KEY`             | `--apiKey`        | API key for authentication                                 |
| `LANGWATCH_ENDPOINT`            | `--endpoint`      | API endpoint (default: `https://app.langwatch.ai`)         |
|                                 | `--http`          | Serve over HTTP and SSE instead of stdio                   |
|                                 | `--port`          | HTTP port (default: `3000`)                                |
| `LANGWATCH_MCP_HTTP_HOST`       | `--host`          | HTTP listen address (default: `127.0.0.1`)                 |
| `LANGWATCH_MCP_ALLOWED_ORIGINS` | `--allowedOrigin` | Browser origins allowed to call the HTTP server            |
| `LANGWATCH_MCP_TRUST_PROXY`     |                   | Use `X-Forwarded-For` as the rate limit key (default: off) |

### HTTP mode

In HTTP mode each client brings its own API key in an `Authorization: Bearer <key>`
header, on every MCP request rather than only at session start. That covers
`/mcp`, `/sse`, and `/messages`. The key is checked against the LangWatch API
before a session is created and re-checked on each request, so a session id by
itself grants no access and revoking a key stops its sessions being served
within a minute. The API key is never read from a query parameter.

Because authentication happens before routing, this applies to the documentation
tools too: unlike stdio mode, they are not reachable without a valid key.

Three routes do not take the bearer. `/health` reports liveness only.
`/.well-known/oauth-authorization-server` is the discovery document clients read
before they hold a token. `/oauth/token` exchanges an API key, sent as
`client_secret` in the form body, for a short-lived access token; it verifies
that key against the LangWatch API before issuing anything, and the token it
returns is what later MCP requests carry.

The server listens on `127.0.0.1` by default, per the MCP transport guidance for
local servers. Pass `--host 0.0.0.0` to accept connections from other machines,
and only behind a network boundary you trust.

Requests carrying a browser `Origin` header are checked against an allowlist.
Loopback origins are always allowed; anything else has to be listed:

```bash
npx @langwatch/mcp-server --http --port 3000 \
  --allowedOrigin https://your-app.example.com
```

#### Running behind a proxy

Forwarded proxy headers resolve the external scheme that the OAuth metadata
document advertises, so they are read by default.

They do not decide the rate limit. Failed authentication is limited per client
address, and that address comes from the socket rather than from
`X-Forwarded-For`, so a client reaching the port directly cannot rotate a header
to reset its own counter. Behind a real proxy every request shares the proxy's
socket address, which means the whole proxy is limited as one client. Set
`LANGWATCH_MCP_TRUST_PROXY=true` there to limit per real client instead, and
only when the proxy overwrites `X-Forwarded-For` on the way in.

This is defense in depth, not the security boundary. API keys are verified
against the LangWatch API before a session is created and re-checked on every
request; the rate limit exists to make guessing expensive, not to decide who
gets in. A spoofable rate limit does not let anyone authenticate.

## Tools

### Documentation

| Tool                   | Description                       |
| ---------------------- | --------------------------------- |
| `fetch_langwatch_docs` | Fetch LangWatch integration docs  |
| `fetch_scenario_docs`  | Fetch Scenario agent testing docs |

### Observability (requires API key)

| Tool              | Description                                                  |
| ----------------- | ------------------------------------------------------------ |
| `discover_schema` | Explore available filters, metrics, aggregations, and groups |
| `search_traces`   | Search traces with filters, text query, and date range       |
| `get_trace`       | Get full trace details with AI-readable formatting           |
| `get_analytics`   | Query timeseries analytics data                              |

### Prompts (requires API key)

| Tool                     | Description                                  |
| ------------------------ | -------------------------------------------- |
| `platform_list_prompts`  | List all prompts                             |
| `platform_get_prompt`    | Get prompt with messages and version history |
| `platform_create_prompt` | Create a new prompt                          |
| `platform_update_prompt` | Update prompt or create new version          |

### Datasets (requires API key)

| Tool                              | Description                                           |
| --------------------------------- | ----------------------------------------------------- |
| `platform_list_datasets`          | List all datasets with record counts                  |
| `platform_get_dataset`            | Get dataset metadata, columns, and record preview     |
| `platform_create_dataset`         | Create a new dataset with optional column definitions |
| `platform_update_dataset`         | Update dataset name or column types                   |
| `platform_delete_dataset`         | Archive a dataset                                     |
| `platform_create_dataset_records` | Add records to a dataset (max 1000 per call)          |
| `platform_update_dataset_record`  | Update a single record                                |
| `platform_delete_dataset_records` | Delete records by IDs (max 1000 per call)             |

### Scenarios (requires API key)

| Tool                        | Description                                                |
| --------------------------- | ---------------------------------------------------------- |
| `platform_list_scenarios`   | List all scenarios, or only the ones filed in a test suite |
| `platform_get_scenario`     | Get scenario details                                       |
| `platform_create_scenario`  | Create a new scenario, optionally filed in a test suite    |
| `platform_update_scenario`  | Update a scenario, or file it in another test suite        |
| `platform_archive_scenario` | Archive a scenario                                         |

### Test suites and run plans (requires API key)

A test suite is a folder of scenarios. A run plan is what you run, and its
name identifies it: running a name that exists replaces that plan's
configuration, running a new name creates the plan. Running a test suite is
sugar over a run plan, and creates or joins the plan `<suite name> <target name>`.

| Tool                          | Description                                        |
| ----------------------------- | -------------------------------------------------- |
| `platform_run_plan`           | Run scenarios against targets, by plan name        |
| `platform_list_run_plans`     | List the run plans of the project                  |
| `platform_get_run_plan`       | Get the full configuration of a run plan           |
| `platform_rerun_run_plan`     | Run a plan again with the configuration it holds   |
| `platform_archive_run_plan`   | Archive a run plan                                 |
| `platform_list_test_suites`   | List the test suites of the project                |
| `platform_create_test_suite`  | Create a test suite                                |
| `platform_get_test_suite`     | Get a test suite and the scenarios filed in it     |
| `platform_rename_test_suite`  | Rename a test suite                                |
| `platform_archive_test_suite` | Archive a test suite and the scenarios filed in it |
| `platform_run_test_suite`     | Run every scenario of a test suite against targets |

### Simulation runs (requires API key)

| Tool                            | Description                                   |
| ------------------------------- | --------------------------------------------- |
| `platform_list_simulation_runs` | List simulation run results                   |
| `platform_get_simulation_run`   | Get one run with its conversation and verdict |

### Evaluators (requires API key)

| Tool                        | Description            |
| --------------------------- | ---------------------- |
| `platform_list_evaluators`  | List all evaluators    |
| `platform_get_evaluator`    | Get evaluator details  |
| `platform_create_evaluator` | Create a new evaluator |
| `platform_update_evaluator` | Update an evaluator    |

### Model Providers (requires API key)

| Tool                            | Description                     |
| ------------------------------- | ------------------------------- |
| `platform_list_model_providers` | List configured model providers |
| `platform_set_model_provider`   | Configure a model provider      |

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
        "--apiKey",
        "your-api-key",
        "--endpoint",
        "http://localhost:5560"
      ]
    }
  }
}
```

## Support

- [Discord Community](https://discord.gg/kT4PhDS2gH)
- [LangWatch Docs](https://langwatch.ai/docs)
- [Email Support](mailto:support@langwatch.ai)
