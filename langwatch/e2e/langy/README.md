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
cd langwatch/e2e/langy
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

## Dogfood additions (ADR-050)

`langy-dogfood.scenario.test.ts` adds the two named flows from the ADR-050 ask —
**find failing traces** (single-turn + cross-turn drill-down) and **open a PR**
(the github internal skill) — and `langy-rules.ts` holds the reusable LLM-judge
rubric (`LANGY_CORE_RULE_CRITERIA`, etc.) that encodes Langy's AGENTS.md absolute
rules. Run it the same way:

```bash
cd langwatch/e2e/langy
LANGY_AGENT_URL=<langy endpoint> \
OPENAI_API_KEY=<virtual-key> OPENAI_BASE_URL=<gateway>/v1 \
npx vitest run langy-dogfood.scenario.test.ts --reporter=verbose
```

> **Adapter caveat.** `langy-agent.ts` still targets the older pod-wrapper
> `/run` HTTP surface (MCP-era). Against the current `services/langyagent`
> manager, point `LANGY_AGENT_URL` at a shim exposing the same `/run` NDJSON
> contract, or refresh `makeLangyAdapter` to drive the manager `/chat` stream.
> The scenario/judge/criteria layer above is transport-agnostic and unchanged.

### Rule-adherence evaluator (over Langy's own traces)

The scenario judge is the primary eval. To ALSO grade Langy on live traffic,
create a saved LLM-boolean `Evaluator` in a staff project and bind it as a
Monitor — server-side, so **no `LANGWATCH_API_KEY`** is involved (avoids the
platform self-ingest loop; see `src/langwatchPlatformGuard.ts`):

```ts
// in a server-side script / tRPC caller scoped to the staff project
const evaluator = await caller.evaluators.create({
  projectId,
  name: "Langy adheres to its rules",
  type: "evaluator",
  config: {
    evaluatorType: "langevals/llm_boolean",
    settings: {
      prompt:
        "Given the user's message and Langy's reply, is the reply terse, does it act " +
        "immediately, and does it avoid clarifying questions, 'next action' offers, and " +
        "narrating the command it ran? Answer true only if all hold.",
    },
  },
});
await caller.monitors.create({
  projectId,
  name: "Langy rule adherence",
  checkType: "langevals/llm_boolean",
  evaluatorId: evaluator.id,
  executionMode: "ON_MESSAGE",
  preconditions: [],
  settings: {},
  sample: 1.0,
});
```

### Seed Langy's versioned prompts

Langy's AGENTS.md + turn-override are stored in the prompt registry via
`pnpm seed:langy-prompts --project <projectId>` (see `scripts/seed-langy-prompts.ts`
and ADR-050).
