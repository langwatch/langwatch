---
name: cli
user-prompt: "Help me use the LangWatch CLI"
description: Use the LangWatch CLI to manage all platform features from the command line. Covers scenarios, evaluators, datasets, agents, workflows, dashboards, traces, analytics, annotations, model providers, and evaluations. The CLI is the primary way agents should interact with LangWatch.
license: MIT
compatibility: Requires npm/pnpm. Works with Claude Code and any terminal-based AI assistant.
---

# LangWatch CLI — The Agent-First Interface

The `langwatch` CLI gives you full access to the LangWatch platform from the terminal. Install it with `npm install -g langwatch` or use `npx langwatch`.

## Setup

1. **Install**: `npm install -g langwatch` (or `pnpm add -g langwatch`)
2. **Login**: `langwatch login` (interactive) or set `LANGWATCH_API_KEY` in your `.env`
3. **Verify**: `langwatch status` to see your project overview

If you already have a `.env` file with `LANGWATCH_API_KEY`, load it:
```bash
export $(grep LANGWATCH_API_KEY .env)
```

## Quick Reference — All Commands

### Project Overview
```bash
langwatch status              # Show resource counts and available commands
langwatch status -f json      # Machine-readable project overview
```

### Scenarios (Agent Test Cases)
```bash
langwatch scenario list                                    # List all scenarios
langwatch scenario get <id>                                # Get scenario details
langwatch scenario create "Name" --situation "..." --criteria "c1,c2" --labels "l1,l2"
langwatch scenario update <id> --name "New Name"           # Update scenario
langwatch scenario delete <id>                             # Archive scenario
```

### Evaluators (Scoring Functions)
```bash
langwatch evaluator list                                   # List all evaluators
langwatch evaluator get <idOrSlug>                         # Get evaluator details
langwatch evaluator create "Name" --type langevals/llm_judge
langwatch evaluator update <idOrSlug> --name "New Name"    # Update evaluator
langwatch evaluator delete <idOrSlug>                      # Archive evaluator
```

### Evaluations (Run Experiments)
```bash
langwatch evaluation run <slug>          # Start an evaluation run
langwatch evaluation run <slug> --wait   # Start and wait for completion
langwatch evaluation status <runId>      # Check run progress
```

### Datasets
```bash
langwatch dataset list                                     # List all datasets
langwatch dataset create "Name" -c input:string,output:string
langwatch dataset get <slugOrId>                           # Get dataset details
langwatch dataset upload <slug> <file>                     # Upload CSV/JSON/JSONL
langwatch dataset download <slugOrId> -f csv               # Download as CSV
langwatch dataset records list <slugOrId>                  # List records
langwatch dataset records add <slugOrId> --json '[{...}]'  # Add records
langwatch dataset records delete <slugOrId> <id1> <id2>    # Delete records
```

### Traces (Observability)
```bash
langwatch trace search                           # Search recent traces (last 24h)
langwatch trace search -q "error" --limit 10     # Search with query
langwatch trace search --start-date 2026-01-01   # Custom date range
langwatch trace get <traceId>                    # Get full trace details
langwatch trace get <traceId> -f json            # Raw JSON trace data
```

### Analytics
```bash
langwatch analytics query                              # Default: trace count, last 7 days
langwatch analytics query --metric total-cost          # Total cost
langwatch analytics query --metric avg-latency         # Average latency
langwatch analytics query --metric p95-latency         # P95 latency
langwatch analytics query --metric total-tokens        # Total tokens
langwatch analytics query --metric eval-pass-rate      # Evaluation pass rate
langwatch analytics query -f json                      # Raw JSON output
```

Available presets: `trace-count`, `user-count`, `total-cost`, `avg-latency`, `p95-latency`, `total-tokens`, `avg-tokens`, `eval-pass-rate`

### Agents
```bash
langwatch agent list                                       # List all agents
langwatch agent get <id>                                   # Get agent details
langwatch agent create "Name" --type http --config '{"url":"..."}'
langwatch agent delete <id>                                # Archive agent
```

Agent types: `signature` (LLM prompt), `code` (Python), `workflow` (sub-workflow), `http` (external API)

### Workflows
```bash
langwatch workflow list                # List all workflows
langwatch workflow get <id>            # Get workflow details
langwatch workflow delete <id>         # Archive workflow
```

### Dashboards
```bash
langwatch dashboard list               # List all dashboards
langwatch dashboard create "Name"      # Create dashboard
langwatch dashboard delete <id>        # Delete dashboard
```

### Annotations (Trace Feedback)
```bash
langwatch annotation list                                  # List all annotations
langwatch annotation list --trace-id <traceId>             # Filter by trace
langwatch annotation get <id>                              # Get annotation details
langwatch annotation create <traceId> --comment "..." --thumbs-up
langwatch annotation create <traceId> --thumbs-down        # Negative feedback
langwatch annotation delete <id>                           # Delete annotation
```

### Model Providers
```bash
langwatch model-provider list                              # List providers
langwatch model-provider set openai --enabled true --api-key sk-...
langwatch model-provider set anthropic --default-model claude-sonnet-4-20250514
```

### Prompts
```bash
langwatch prompt init                    # Initialize prompts project
langwatch prompt create <name>           # Create prompt YAML
langwatch prompt list                    # List remote prompts
langwatch prompt sync                    # Sync local ↔ remote
langwatch prompt pull                    # Pull remote → local
langwatch prompt push                    # Push local → remote
langwatch prompt tag list                # List tags
langwatch prompt tag create <name>       # Create tag
langwatch prompt tag assign <prompt> <tag>  # Assign tag to version
```

## JSON Output for Scripting

Every list/get command supports `-f json` or `--format json` for machine-readable output:

```bash
langwatch scenario list -f json | jq '.[0].id'
langwatch evaluator get my-evaluator -f json | jq '.config'
langwatch analytics query --metric total-cost -f json | jq '.currentPeriod'
```

## Common Workflows

### Set up a complete evaluation pipeline
```bash
# 1. Create evaluator
langwatch evaluator create "Quality Check" --type langevals/llm_judge

# 2. Create dataset
langwatch dataset upload qa-data test-data.csv

# 3. Create scenario
langwatch scenario create "Happy Path" --situation "User asks a simple question" --criteria "Accurate answer,Friendly tone"

# 4. Run evaluation
langwatch evaluation run quality-check --wait
```

### Monitor production performance
```bash
# Quick health check
langwatch status
langwatch analytics query --metric trace-count
langwatch analytics query --metric avg-latency
langwatch trace search -q "error" --limit 5
```

### Review and annotate traces
```bash
langwatch trace search --limit 20
langwatch trace get <traceId>
langwatch annotation create <traceId> --comment "Good response" --thumbs-up
```
