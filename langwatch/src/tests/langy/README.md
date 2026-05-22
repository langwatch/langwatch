# Langy Scenario Tests

End-to-end scenario tests for Langy (the LangWatch in-product AI assistant).

## How it works

Tests use `@langwatch/scenario` for two-layer verification:
- **Layer 1**: LLM judge grades Langy's response quality against human-readable criteria
- **Layer 2**: Direct REST calls to `localhost:5560` confirm side-effects actually landed (dataset created, evaluator exists, etc.)

Langy runs inside an OpenCode pod in Minikube and uses the **MCP server** (`langwatch-mcp-server`) for all platform actions — no new API endpoints.

## Prerequisites

1. Minikube pod running: `kubectl apply -f C:\agent\pod.yaml` (image `opencode-agent:v4`)
2. Port-forward open: `kubectl port-forward pod/opencode-agent 8081:8080 --address 0.0.0.0`
3. LangWatch app running: `make start` from `langwatch-langy-redesign/`
4. AI Gateway running: `make service svc=aigateway` from `langwatch-langy-redesign/`

## Run

```bash
cd langwatch/src/tests/langy
LANGY_AGENT_URL=http://172.22.160.1:8081 \
OPENAI_API_KEY=<your-virtual-key> \
OPENAI_BASE_URL=http://localhost:5563/v1 \
LANGWATCH_API_KEY=<your-langwatch-api-key> \
LW_BASE_URL=http://localhost:5560 \
npx vitest run langy.scenario.test.ts --reporter=verbose
```

## Coverage (42 scenarios)

| Surface | Tests | Layer 2 |
|---|---|---|
| Traces (search, failure analysis, drill-down) | 3 | - |
| Analytics (cost, latency, p95, pass rate, time range, with URL) | 6 | - |
| Datasets (list, create, create with rows, multi-step, multi-turn update) | 5 | ✓ |
| Evaluators (list, create, update, multi-turn create) | 4 | ✓ |
| Scenarios (list, create, create+run) | 3 | ✓ |
| Agents (list, create) | 2 | ✓ |
| Monitors (list, create) | 2 | ✓ |
| Prompts (list, create, update, deep-link) | 4 | ✓ |
| Triggers (list, create) | 2 | ✓ |
| Dashboards (list, create, deep-link) | 3 | ✓ |
| Workflows (list) | 1 | - |
| Audit / improve setup | 1 | - |
| Session memory (2-turn, 3-turn) | 2 | - |
| Negative (out-of-scope, no pagination, empty results, no clarifying Qs, no next actions) | 5 | - |

## Known plan limits

The free plan caps at 3 datasets and 3 agents. The `beforeAll` hook deletes stale test datasets before each run. If agent creation fails, delete old test agents from the LangWatch UI.
