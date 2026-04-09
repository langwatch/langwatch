# LangWatch Feature Map

> Generated from `feature-map.json` — the canonical information architecture.
> Every feature has **surfaces** (code, platform, API, docs) and a **sync** state.

Legend: ✓ = exists, — = not available, planned = `plannedSync` set

## Observability

| Feature | code.sdk | code.cli | code.skill | platform.ui | platform.mcp | api | sync |
|---------|----------|----------|------------|-------------|--------------|-----|------|
| **Tracing** | py:`langwatch.trace` ts:`langwatch` | — | `tracing` | `/messages` | — | `/api/collector` | code→platform |
| **Analytics** | — | — | `analytics` | `/analytics` | `get_analytics`, `search_traces`, `get_trace` | `/api/analytics` | — |
| **User Events** | py:`langwatch.track_event` | — | — | — | — | `/api/track_event` | code→platform |
| **Annotations** | — | — | — | `/annotations` | — | `/api/annotations` | — |

## Evaluations

| Feature | code.sdk | code.cli | code.skill | platform.ui | platform.mcp | api | sync |
|---------|----------|----------|------------|-------------|--------------|-----|------|
| **Experiments** | py:`langwatch.experiment` ts:`langwatch.experiments` | — | `evaluations` | `/evaluations` | — | `/api/experiment` | code→platform |
| **Online Evaluation** | py:`langwatch.evaluation` | — | `evaluations` | `/evaluations` | — | `/api/evaluations` | — |

> Online Evaluation includes guardrails via code (`as_guardrail=True`). Platform side uses Monitors.

## Agent Simulations

| Feature | code.sdk | code.skill | platform.ui | platform.mcp | platform.skill | api | sync |
|---------|----------|------------|-------------|--------------|----------------|-----|------|
| **Scenarios** | py:`langwatch-scenario` ts:`@langwatch/scenario` | `scenarios` | `/simulations/scenarios` | `platform_*_scenario` | `scenarios` | `/api/scenarios` | — (planned: bidirectional) |
| **Runs** | — | — | `/simulations` | — | — | — | — |

## Prompt Management

| Feature | code.sdk | code.cli | code.skill | platform.ui | platform.mcp | api | sync |
|---------|----------|----------|------------|-------------|--------------|-----|------|
| **Prompts** | py/ts:`langwatch.prompts` | `prompt init/create/sync/...` | `prompts` | `/prompts` | `platform_*_prompt` | `/api/prompts` | **bidirectional** |
| **Prompt Playground** | — | — | — | `/prompts` | — | `/api/playground` | — |

## Library

| Feature | code.sdk | code.skill | platform.ui | platform.mcp | platform.skill | api | sync |
|---------|----------|------------|-------------|--------------|----------------|-----|------|
| **Agents** | — | — | `/agents` | — | — | — | — |
| **Workflows** | — | — | `/workflows` | — | — | `/api/workflows` | — |
| **Evaluators** | py/ts:`langwatch.evaluators` | `evaluations` | `/evaluators` | `platform_*_evaluator` | `evaluations` | `/api/evaluations` | — |
| **Datasets** | py:`langwatch.dataset` | `evaluations` | `/datasets` | — | — | `/api/dataset` | — |

## Settings

| Feature | platform.ui | platform.mcp | api |
|---------|-------------|--------------|-----|
| **Model Providers** | `/settings` | `platform_*_model_provider` | — |

## Meta Skills

Skills that span multiple features:

| Skill | Description |
|-------|-------------|
| `level-up` | Orchestrates tracing + prompts + evaluations + scenarios |
| `analytics` | Query performance via MCP (works for devs and PMs) |

## MCP Documentation Tools

| Tool | Purpose |
|------|---------|
| `fetch_langwatch_docs` | Access LangWatch integration and platform docs |
| `fetch_scenario_docs` | Access Scenario agent testing docs |
| `discover_schema` | Discover available filters, metrics, evaluator types |
