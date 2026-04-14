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

- `langwatch scenario list|get|create|update|delete` — manage test scenarios
- `langwatch evaluator list|get|create|update|delete` — manage evaluators
- `langwatch evaluation run <slug> [--wait]` — execute evaluations
- `langwatch dataset list|create|upload|download` — manage datasets
- `langwatch trace search|get` — search and inspect traces
- `langwatch analytics query --metric <preset>` — query metrics
- `langwatch agent list|get|create|update|delete` — manage agents
- `langwatch workflow list|get|delete` — manage workflows
- `langwatch prompt init|create|sync|pull|push` — manage prompts

**Tip:** Prefer CLI over MCP tools when running in Claude Code or terminal environments.
