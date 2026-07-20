# Langy Scenario Tests

End-to-end scenario tests for Langy (the LangWatch in-product AI assistant).

## How it works

Tests use `@langwatch/scenario` for two-layer verification, plus a third browser-QA
pass (see "Browser QA" below):
- **Layer 1**: LLM judge grades Langy's response quality against human-readable criteria
- **Layer 2**: Direct REST calls to `LW_BASE_URL` confirm side-effects actually landed (dataset created, evaluator exists, etc.)

`langy-agent.ts`'s `makeLangyAdapter()` drives Langy through the **real product
surface** — the same `langy.createConversation` / `langy.continueConversation`
tRPC mutations and `langy.onTurnStream` SSE subscription the browser panel uses
(`src/features/langy/logic/langyChatTransport.ts`) — authenticated as a real
user session. It is NOT a shortcut/mock transport, so a passing scenario proves
the whole stack (app → `services/langyagent` → aigateway → provider) works.

## Prerequisites

A running LangWatch app stack with Langy reachable — e.g. `pnpm dev:haven`
(see root `CLAUDE.md`, "Local dev by hostname"), or any stack where you can
reach the app's tRPC/SSE endpoints and sign in as a real user.

## Run

```bash
cd langwatch/e2e/langy
LANGY_APP_URL=<your app URL, e.g. https://app.<slug>.langwatch.localhost:1355> \
LANGY_PROJECT_ID=<project id> \
LANGY_ADMIN_EMAIL=<a real user's email on that project> \
LANGY_ADMIN_PASSWORD=<that user's password> \
LW_BASE_URL=<same as LANGY_APP_URL> \
LANGWATCH_API_KEY=<that project's API key> \
LANGWATCH_ENDPOINT=<same as LANGY_APP_URL, so scenario events report locally instead of to app.langwatch.ai> \
OPENAI_API_KEY=<a real OpenAI key or a gateway virtual key> \
npx vitest run langy.scenario.test.ts --reporter=verbose
```

All `LANGY_*` vars default to this repo's local haven seed identity
(`langy-workspace` slug, `admin@haven.localhost` / `local-dev-project`) — see
the top of `langy-agent.ts`. Override them to point at a different stack.

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
npx vitest run langy-dogfood.scenario.test.ts --reporter=verbose
```

(same env vars as above — defaults already point at the local haven seed identity.)

## Red team

`langy-redteam.scenario.test.ts` uses `@langwatch/scenario`'s `redTeamCrescendo()`
(NOT a hand-rolled adversarial prompt set) to probe jailbreak / prompt-injection /
destructive-action-without-confirmation attempts across 14 categories, judged
against `LANGY_CORE_RULE_CRITERIA` plus attack-specific criteria. Run the same way.

## Browser QA

`browser-qa.ts` adds a third, independent check after every scenario (not just
ones with an obvious side effect): a real Playwright pass that logs in and looks
at the actual product surface — confirming a claimed create/update/delete really
happened (or, for a destructive jailbreak attempt, really did NOT happen) — and
captures a screenshot as evidence. This is wired into `scenario-logger.ts`'s
`runScenarioAndLog`, so every transcript in `scenario-logs/` gets a "Browser QA"
section with the verdict and screenshot path.

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
