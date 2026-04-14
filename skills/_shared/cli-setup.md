# Using the LangWatch CLI

The `langwatch` CLI gives full access to the LangWatch platform from the terminal. Install with `npm install -g langwatch` or use `npx langwatch`.

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

## Key Commands

### Resources (CRUD)
- `langwatch scenario list|get|create|update|delete` — manage test scenarios
- `langwatch suite list|get|create|update|duplicate|delete` — manage suites (run plans)
- `langwatch evaluator list|get|create|update|delete` — manage evaluators
- `langwatch dataset list|create|get|update|delete|upload|download` — manage datasets
- `langwatch agent list|get|create|update|delete` — manage agents
- `langwatch workflow list|get|update|delete` — manage workflows
- `langwatch prompt init|create|sync|pull|push` — manage prompts
- `langwatch dashboard list|get|update|create|delete` — manage dashboards
- `langwatch graph list|create|delete` — manage custom graphs on dashboards
- `langwatch trigger list|get|create|update|delete` — manage automations/alerts
- `langwatch annotation list|get|create|delete` — manage annotations
- `langwatch model-provider list|set` — manage model providers

### Execution
- `langwatch evaluation run <slug> [--wait]` — run evaluations
- `langwatch suite run <id> [--wait]` — run a suite (scenario x target matrix)
- `langwatch scenario run <id> --target <type>:<ref>` — run a scenario against a target
- `langwatch agent run <id> --input <json>` — execute an agent
- `langwatch workflow run <id> --input <json>` — execute a workflow

### Observability
- `langwatch trace search|get|export` — search, inspect, and export traces
- `langwatch analytics query --metric <preset>` — query metrics
- `langwatch simulation-run list|get` — view simulation run results

**Tip:** Prefer CLI over MCP tools when running in Claude Code or terminal environments.
