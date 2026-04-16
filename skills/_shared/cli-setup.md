# Using the LangWatch CLI

The `langwatch` CLI gives full access to the LangWatch platform from the terminal — including documentation. Install with `npm install -g langwatch` or use `npx langwatch` (no install needed).

## Setup

Set `LANGWATCH_API_KEY` in your `.env` file, or run `langwatch login` interactively.

```bash
# Load from .env
export $(grep LANGWATCH_API_KEY .env)

# Or login interactively
langwatch login
```

## Quick Start

```bash
langwatch status                    # Project overview
langwatch --help                    # All available commands
langwatch <command> --help          # Help for any command
```

All list/get commands support `--format json` for machine-readable output.

## Read the Docs (do this BEFORE you start coding)

The CLI fetches documentation as Markdown. Always read the relevant docs first; do NOT guess SDK APIs or CLI flags.

```bash
langwatch docs                                       # LangWatch docs index (llms.txt)
langwatch docs integration/python/guide              # Python integration guide
langwatch docs integration/typescript/guide          # TypeScript integration guide
langwatch docs prompt-management/cli                 # Prompts CLI guide
langwatch docs evaluations/experiments/sdk           # Experiments SDK guide
langwatch docs evaluations/online-evaluation/overview # Online evaluation
langwatch docs evaluations/guardrails/code-integration # Guardrails

langwatch scenario-docs                              # Scenario docs index
langwatch scenario-docs agent-integration            # Adapter patterns
langwatch scenario-docs advanced/red-teaming         # Red teaming guide
```

The path is forgiving: missing `.md` is appended automatically, leading slashes are stripped, and full URLs work too. If `langwatch` isn't available at all (e.g. inside ChatGPT or another web assistant with no shell), see [docs fallback](llms-txt-fallback.md) to fetch the same files via plain HTTP.

## Key Commands

### Resources (CRUD)
- `langwatch scenario list|get|create|update|delete` — manage test scenarios
- `langwatch suite list|get|create|update|duplicate|delete` — manage suites (run plans)
- `langwatch evaluator list|get|create|update|delete` — manage evaluators
- `langwatch dataset list|create|get|update|delete|upload|download` — manage datasets
- `langwatch agent list|get|create|update|delete` — manage agents
- `langwatch workflow list|get|update|delete` — manage workflows
- `langwatch prompt init|create|sync|pull|push|versions|restore` — manage prompts
- `langwatch dashboard list|get|update|create|delete` — manage dashboards
- `langwatch graph list|create|update|delete` — manage custom graphs on dashboards
- `langwatch trigger list|get|create|update|delete` — manage automations/alerts
- `langwatch annotation list|get|create|delete` — manage annotations
- `langwatch secret list|get|create|update|delete` — manage project secrets (encrypted env vars)
- `langwatch monitor list|get|create|update|delete` — manage online evaluation monitors
- `langwatch model-provider list|set` — manage model providers

### Execution
- `langwatch evaluation run <slug> [--wait]` — run evaluations
- `langwatch suite run <id> [--wait]` — run a suite (scenario × target matrix)
- `langwatch scenario run <id> --target <type>:<ref>` — run a scenario against a target
- `langwatch agent run <id> --input <json>` — execute an agent
- `langwatch workflow run <id> --input <json>` — execute a workflow

### Observability
- `langwatch trace search|get|export` — search, inspect, and export traces
- `langwatch analytics query --metric <preset>` — query metrics
- `langwatch simulation-run list|get` — view simulation run results
