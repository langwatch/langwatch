# Agent + Evaluator node kinds in nlpgo — scope + plan

> Scoping doc for tasks (b) + (c) per @rchaves's iter-17 direction:
> *"agent and evaluator should just work man!! they are simple (ish) they just call langwatch back, using langwatch api itself, the tricky part for evaluators is to propagate back the cost, score, details, passed, everything. ADD e2e TESTS FOR IT, EVALUATORS SPECIALLY"*

## What's wrong today

The Go engine returns `unsupported_node_kind` (501) for any of `agent`, `evaluator`,
`retriever`, `custom`. This forces the TS feature flag to fall back to Python for
any workflow that uses these — which is most workflows in production.

Per @rchaves, the goal is *"never fall back to python as much as possible"*, so:

| Kind        | New behavior in nlpgo                            |
|-------------|--------------------------------------------------|
| `agent`     | **Implement natively** — calls back to langwatch API |
| `evaluator` | **Implement natively** — calls back to langwatch evaluator API; propagates cost/score/details/passed exactly |
| `retriever` | **Throw an error** — feature is retired |
| `custom`    | **Throw an error** — not a real node kind |

## Reference: how Python NLP does it today

### Evaluator (langwatch_nlp/langwatch_nlp/studio/modules/evaluators/langwatch.py)

```python
class LangWatchEvaluator(Evaluator):
    def forward(self, **kwargs):
        result = langwatch.evaluations.evaluate(
            self.evaluator,        # slug, e.g. "ragas/answer_correctness"
            name=self.name,
            settings=self.settings,
            api_key=self.api_key,
            data=kwargs,           # {input, output, expected_output, contexts, expected_contexts}
        )
        return EvaluationResultWithMetadata(
            status=result.status,            # processed / skipped / error
            score=float(result.score),
            passed=result.passed,
            details=result.details,
            label=result.label,
            cost=Money(...),
            inputs=kwargs,
            duration=...,
        )
```

The Python SDK's `langwatch.evaluations.evaluate(evaluator, ...)` POSTs to the
**LangWatch evaluator endpoint** (which is in this same repo at
`langwatch/src/app/api/evaluators/[[...route]]/app.ts`). For `evaluator =
"ragas/answer_correctness"`, the wire path is something like
`POST /api/evaluators/ragas/answer_correctness/evaluate`.

### Agent

No standalone Python file — agent execution flows through DSPy with custom
adapters. The "agent" node calls back to langwatch's own SDK / MCP surface.
Need to read `langwatch_nlp/langwatch_nlp/studio/modules/registry.py` and
`langwatch_nlp/langwatch_nlp/studio/dspy/custom_node.py` to map exact behavior.

## Plan

### Step 1 — Wire decoder + types

`services/nlpgo/app/engine/dsl/` already round-trips the DSL JSON. Verify that
`agent` and `evaluator` node kinds parse without error (they should already —
the unsupported-kind rejection is at execution time, not parse time).

### Step 2 — Evaluator block

`services/nlpgo/app/engine/blocks/evaluatorblock/`:
- `block.go` — `EvaluatorBlock` implementing `engine.Block`.
- `client.go` — typed HTTP client for LangWatch evaluator API:
  - `POST {LANGWATCH_BASE_URL}/api/evaluators/{evaluator_slug}/evaluate`
  - Body: `{ data: kwargs, settings: nodeSettings, name: nodeName }`
  - Auth: project apiKey passed in `X-Auth-Token` header (existing pattern, see
    `langwatch/src/server/api/middleware/auth.ts`)
- `result.go` — parse response into a result struct exposing
  `Status / Score / Passed / Details / Label / Cost / Duration`.

The block's `Execute(ctx, input)` should:
1. Validate required fields (`evaluator` slug, `api_key`, optional `name` + `settings`).
2. Build the data payload from the node's resolved input fields
   (input/output/expected_output/contexts/expected_contexts depending on the
   evaluator's required signature).
3. POST + parse response.
4. Surface as a node output struct on success; surface `result.error` event +
   propagate `details` as `error` message on failure.

### Step 3 — Agent block

`services/nlpgo/app/engine/blocks/agentblock/`:
- Spec is fuzzier; need to read the Python registry + custom_node to map exact
  behavior. Defer to a follow-up sub-plan once the evaluator block lands and
  proves the langwatch-API-callback pattern works.
- One key constraint: the agent block typically runs an LLM-driven loop with
  tool calls back to langwatch's MCP surface. May involve recursive engine
  calls or SSE-back-pressure.

### Step 4 — Retired kinds

Engine emits a typed error for `retriever` and `custom` kinds:
- `retriever` → `engine_error` event with `kind: "retired_node_kind"`,
  `message: "retriever was retired; remove the node from the workflow"`.
- `custom` → same shape, message: "custom node kind is not supported".

These errors propagate through the SSE stream so the Studio UI surfaces them.

### Step 5 — E2E tests

Per rchaves, **mandatory**:
1. New TS integration test in `langwatch/src/server/workflows/__tests__/`:
   - Creates a project + workflow with `entry → signature → evaluator → end` shape.
   - Forces FF=on.
   - Calls `runWorkflow` (and the new SSE post_event path Sarah's adding).
   - Asserts the evaluator's `score`, `passed`, `details`, `cost` all land in
     the workflow result + the per-node trace.
2. Real evaluator: pick `langevals/exact_match` (no LLM cost, deterministic) and
   maybe `ragas/answer_correctness` (LLM-based, real cost) so we cover both
   trivial + LLM-driven evaluator shapes.
3. Same for agent kind once that block lands.

## Open questions for rchaves before implementing

- Which langwatch API URL does the Python SDK call — same host as the calling app,
  or a separate evaluator service URL? (probably same host = `LANGWATCH_BASE_URL`,
  but the evaluators API mounts at `/api/evaluators/[[...route]]/app.ts` and may
  be Hono-only).
- For nlpgo running in a Lambda: the call from nlpgo back to the langwatch app
  goes over the **public URL** (Lambda has no internal network access).
  Confirm this is OK from a latency + auth standpoint, or whether nlpgo should
  short-circuit to a different evaluator surface.
- Any existing observability requirements for the evaluator span chain
  (langwatch.origin propagation, parent-trace linking)?

## Cross-thread coordination

- @sarah is on (a): wiring `studioBackendPostEvent` to `/go/studio/execute` SSE
  when FF=on. Once that lands, my evaluator-block work + her SSE wiring meet
  at the integration test.
- This scoping doc gets removed once both blocks ship and tests are green.
- PR description must lose the "501 fallback for agent/evaluator" wording —
  Sarah is taking that as part of (a) cleanup.
