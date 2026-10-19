# ADR-180: Scenario run hooks: setup and teardown on connected agents

**Date:** 2026-10-16

**Status:** Proposed

## Context

A scenario against a connected agent (ADR-128) often needs data that exists before the first turn and must be removed after the last: a customer with a loyalty tier, an order to refund. Today the scenario author cannot create that data. The agent function only sees turns, so test data is made by hand or leaks into the project.

What the platform already has: run parameters resolved once per run and shared by the agent and the situation text; a `session` value that travels in every call envelope and result frame (64 KiB cap) so no sticky routing is needed; a scenario child that runs the whole run and prints one result line, which the parent turns into a platform event (`AGENT_INSTANCE_RECORDED`); adapters for the simulated user and the judge that the platform builds itself in `apps/scenario-child` (`scenario-child-execution.service.ts`).

## Decision

We will add two optional hooks to a connected agent, **setup** and **teardown**, run by the platform around the turns of a scenario run.

### SDK surface

Python:

```python
@shop_assistant.scenario.setup
def setup(run, loyalty_tier: str = "none", refund_amount: float = 49.95) -> dict: ...

@shop_assistant.scenario.teardown
def teardown(run, state, loyalty_tier: str = "none") -> dict | None: ...
```

TypeScript mirrors this on the value `connectAgent` returns. `run` is `{ scenarioRunId, scenarioName, batchRunId }`. Setup returns **state**, a JSON object. Teardown receives that state and may return an object, which the run shows. Hook parameters come from the run parameters the agent already uses: one value per name per run, and the hook signatures merge into the agent's one run-parameter schema (a name declared twice must agree on type, or `register` is refused with `parameters_invalid`).

### Protocol

- `register` gains `hooks: { setup: boolean, teardown: boolean }` per agent. The platform keeps the declaration per instance, so instances of one agent on older and newer SDKs can run side by side: a hook call goes only to an instance that declared that hook, and when no live instance did, it fails with `hook_not_declared` instead of running the agent function.
- The `call` envelope gains `kind: "turn" | "setup" | "teardown"` (default `turn`) and `state`. The `result` frame gains `state`: setup's return, or a turn's update.
- The relay call body gains `timeoutMs`, the hook's budget. The platform sets a hook call's `deadlineAt` from it; a turn keeps the agent's own timeout.
- State travels in every call, as `session` does, so no sticky routing is needed. A turn receives `state` and may return an update; the platform keeps the latest.
- State and teardown's returned object are capped at 64 KiB, the `session` cap. Over the cap fails the call as `agent_payload_too_large`.
- `CALL_ENVELOPE_KEYS` in the connected-agent protocol gains `kind` and `state`; its test changes with it.

### Run order

Setup, then turns, then teardown. The simulated user and the judge see the current state on every turn: the platform wraps them in its own adapters in `apps/scenario-child`, so the external scenario library does not change.

The child attempts teardown after success, after failure, and after a setup failure or timeout (with the partial state, if any). The child runs it in a `finally`. If the child is killed, the parent worker should run a fallback teardown. Decided in principle; not built yet (https://github.com/langwatch/langwatch/issues/8781).

Hooks run for scenario runs only. Experiments, the Test button and `langwatch agent run` never call them. Each hook has a 60 s timeout. A timeout set per scenario is not built yet.

### Outcomes

- Setup failed or timed out (or its agent was offline): the run is not scored and is excluded from the pass rate, in the batch summary and the suite roll-up. It finishes `ERROR` with no verdict, so every reader that counts verdicts leaves it out. Readers that count statuses (the ClickHouse batch and set counts, the results atoms) read `langwatch.hooks.setup.status` on `ERROR` runs and leave a setup that is not `ok` out of the pass rate, as the browser does.
- Teardown never changes the score. A failed teardown shows its error, the state it was given and the line "Test data may be left behind." A teardown that timed out keeps `timed_out` in the record and reads "Teardown failed" with the timeout error.
- **Rerun and keep data** skips teardown for that one rerun and is never saved to a plan. The run shows "Teardown skipped" (on purpose). "Teardown not run" means an accident, such as the agent being offline.
- An agent that declares no hooks runs as today and is marked "No hooks".

### Recording

The child's result line carries each hook's result to the parent, which records a new platform event, like `AGENT_INSTANCE_RECORDED`, folded into the run state. Each hook records status, duration, trace (`traceparent`), state or returned object, and error (its first 1,000 characters; see the open items).

### Open items

- **OPEN, proposed by the agent, not decided by the owner:** hooks run on the Node child only in v1. A project with `release_scenario_go_runner_enabled` routes runs of agents that declare hooks to the Node child. Go parity comes later.
- **OPEN, proposed by the agent, not decided by the owner:** the run record keeps the first 1,000 characters of a hook error, since the text comes from the agent with no size limit. Spec: `modules/scenario/specs/scenario-run-hooks.feature`.

### Inline run parameters in situation text (decided by the owner)

In this series, `{ key: value }` (single braces) in a scenario's situation text creates a run parameter inline: it declares the parameter `key` with the default `value`, and the run shows the value it used. Liquid (`{{ params.x }}`, `{{ variable }}`) keeps working as today. The platform handles the single-brace form before Liquid, since liquidjs throws `TokenizationError` on `{{ key: value }}` and must never see it. A `{` that is not a `{ key: value }` declaration stays as text. Mixing the inline form with Liquid `{{ variable }}` is a later upgrade, out of this series. This needs its own PR slice, apart from the hooks. Its spec ships with that slice.

## Rationale / Trade-offs

Putting hooks in the customer's process gives them their own database and secrets, which is the point of connected agents. Declaring hooks at `register` stops the platform calling an SDK that cannot answer. Carrying state in every call costs payload but avoids sticky routing and works across N instances, as `session` does. Wrapping the simulated user and the judge in platform adapters keeps the scenario library untouched. The cost: the state goes into the simulated user's and the judge's prompts on every turn, so it spends tokens, and the test data reaches the model provider. Setup should return references, not bulk data or secrets. Excluding setup failures from the pass rate stops an infrastructure fault reading as an agent failure; teardown not touching the score keeps the score about the agent.

## Consequences

The register frame, call envelope and result frame change (additively; `protocol` stays 1). Run state gains hook records and a new event. The run view gains hook rows and the labels above. Series follow-ups: SDKs, platform calling hooks, scoring, run-result UI, dogfooding on the platform's own assistant, then docs in `docs/agent-testing/` after dogfooding.

## References

- Related ADRs: ADR-128 (connected agents)
- Specs: `modules/agent/specs/scenario-hooks-protocol.feature`, `modules/scenario/specs/scenario-run-hooks.feature`, `specs/scenarios/served-agent-instance-on-runs.feature`, `specs/scenarios/scenario-run-parameters.feature`, `specs/scenarios/go-scenario-runner.feature`
