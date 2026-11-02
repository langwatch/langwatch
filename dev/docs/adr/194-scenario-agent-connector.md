# ADR-194: Scenario Agent Connector: setup and teardown live in LangWatch

**Date:** 2026-11-02

**Status:** Proposed

## Context

A scenario often needs test data that exists before the first turn and is removed after the last: a throwaway account, an order to refund. Today there are two ways to make it, and both put code in the customer's hands:

- **Connected agents** (ADR-180, [180-scenario-run-hooks.md](180-scenario-run-hooks.md)): setup and teardown are functions in the customer's process, which must stay online.
- **HTTP agents** (ADR-188, proposed on https://github.com/langwatch/langwatch/pull/8956, built on https://github.com/langwatch/langwatch/pull/9193, https://github.com/langwatch/langwatch/pull/9194 and https://github.com/langwatch/langwatch/pull/9195; not on main): a hooks URL the customer hosts, signed by LangWatch.

A customer found this too much to maintain. The owner decided on 2026-11-02 to build an in-app **Scenario Agent Connector** (epic https://github.com/langwatch/tasks/issues/1063): setup and teardown are defined in LangWatch from existing parts, and the customer only exposes the agent's HTTP API.

What main already has, and the Connector can reuse:

- **The hook lifecycle is on main and is caller-agnostic.** `ScenarioRunHooksService.around` runs setup, the turns, then teardown in a `finally`, records each hook, and never lets teardown change the score (`apps/scenario-child/src/services/scenario-run-hooks.service.ts:100-115`). It calls hooks through a two-member interface, `ScenarioHookCaller { runState; callHook({ kind, timeoutMs }) }` (`:20-23`). Only the wiring picks connected agents: `hookTargetOf` returns null for any other agent type (`apps/scenario-child/src/services/scenario-child-execution.service.ts:209-222`).
- **The record is on main.** `ScenarioHookResult` with statuses `ok | failed | timed_out | skipped | not_run`, the 60 s `DEFAULT_HOOK_TIMEOUT_MS`, and "Not scored" when setup is not `ok` (`modules/scenario/contract/src/features/execution/scenario-hooks.ts:11,17,56-59`); the `lw.simulation_run.hooks_recorded` event (`modules/scenario/process/src/eventing/simulation-processing.commands.ts:115`); the Setup and Teardown bands on the run.
- **Code execution from a scenario run is on main.** A code agent's turn runs as a one-node `entry -> code -> end` workflow on nlpgo's `/go/studio/execute_sync` (`apps/scenario-child/src/channels/http/http.serialized-code-agent.channel.ts:208,376`), with project secrets as the `secrets` namespace, resolved by the prefetch (`modules/scenario/process/src/features/prefetch/services/scenario-target-prefetch.service.ts:175-192`) through `SecretApi.getValuesByName` (`modules/secret/contract/src/secret.api.ts:28`).
- **Code-block isolation.** https://github.com/langwatch/langwatch/pull/9050 (merged) isolates one execution from another inside nlpgo. No code block has a network fence today: the Python subprocess runtime lets a block open any socket (`specs/nlp-go/code-block.feature:336-340`), and `specs/security/tenant-aware-egress-isolation.feature` marks "A code block is denied network access by default" as `@unimplemented`. https://github.com/langwatch/langwatch/pull/8991 (open, not on main; its ADR-183) adds a WebAssembly runtime for JavaScript and TypeScript code blocks, but keeps Python on the subprocess runtime by default (WebAssembly is opt-in through `NLPGO_ENGINE_CODE_BLOCK_RUNTIME=wasm`).
- **Datasets** are read through `DatasetApi.getDatasetPage` (`modules/dataset/contract/src/dataset.api.ts:132`).

## Decision

We will add a **Connector** to the HTTP agent: an optional setup step and teardown step, each a code block that LangWatch stores and runs. A run calls them through the existing ADR-180 lifecycle as one more `ScenarioHookCaller`. The customer writes and hosts nothing.

### Data model and ownership

- **The agent module owns the Connector config.** It is a new optional field on the HTTP agent config (`modules/agent/contract/src/config/http.ts:33`), in the existing JSON column. No table, no migration, no catalogue change. Agent copy and sync carry it as they carry the rest of the config.

  ```ts
  connector?: {
    setup?: ConnectorStep;
    teardown?: ConnectorStep;
  }
  ConnectorStep = {
    language: "python";                // other languages when the code-block runtime offers them
    code: string;          // Python source; takes the input, returns the output, as a code agent's block does. 64 KiB cap.
    secretNames: string[]; // project secrets this step may read; nothing else travels
    datasetId?: string;    // optional fixture rows
  }
  ```

- **The scenario module owns the run behaviour.** The prefetch reads the step through `AgentApi` (as it reads the agent today), its named secrets through `SecretApi`, and its dataset rows through `DatasetApi`, and puts them on the job's adapter data. `adapterDeclaresHooks` (`modules/scenario/process/src/rules/scenario-run-hooks.rules.ts:14-17`) counts a Connector step as a declared hook, so the run goes to the Node child as hooked connected runs do.
- **`apps/scenario-child` gains `ConnectorHookCaller`**, a `ScenarioHookCaller` that runs a step through the same `ExecuteSyncTransport` the code agent channel uses. `hookTargetOf` returns it for an HTTP agent with a Connector. `ScenarioRunHooksService` does not change.
- An HTTP agent has at most one hook source. v1 has only one (see the hooks-chain decision), so there is nothing to choose.

### What a step receives and returns

- Input: `{ kind, run: { scenarioRunId, scenarioName, batchRunId }, idempotencyKey, params, secrets, rows?, state? }`.
  - `params` are the run parameters, as every target reads them.
  - `secrets` holds only the names in `secretNames` (code agents today get every listed secret; a step gets less).
  - `rows` is the bound dataset, capped at 64 KiB in total; over the cap fails the step before it runs. The code picks the row it needs, for example by `params.persona`. One run per row is out of scope.
  - `idempotencyKey` is `<scenarioRunId>:<attemptId>:<kind>`, the shape ADR-188 settled, so a step can tag the data it makes and a sweep can find leftovers.
  - `state` is sent to teardown only.
- Setup returns `{ state, secrets? }`.
  - `state` (a JSON object, 64 KiB cap) is the run's state, as in ADR-180. HTTP turn templates read it as `{{ state }}` and `{{ state.NAME }}`; the simulated user and the judge see it each turn; teardown receives it; the run records it.
  - `secrets` (name to string) are **run-scoped secrets**: they override a project secret of the same name for this run only, as secret run parameters already do. Turn templates read them as `{{ secrets.NAME }}`, and teardown receives them. They are never recorded, never shown to the simulated user or the judge, and scrubbed from every error (`scrubKnownSecrets`, `apps/scenario-child/src/rules/execution-error.rules.ts:349`). A throwaway account's password or token goes here, not in `state`.
- Teardown returns an optional object, which the run shows. It never changes the score.
- An HTTP turn cannot change the state, as ADR-188 settled.

### Isolation, egress and timeouts

- Steps run only in nlpgo's code-block sandbox, never in the worker or the scenario child.
- Steps are Python code blocks on today's nlpgo runner, sent by the scenario child as one `execute_sync` POST each, the same transport code agents use in scenarios. Other languages come when the runtime offers them.
- **There is no network fence for steps, and none is a precondition.** No code block has one today (see Context), so a step adds no egress exposure beyond what a code agent already has on cloud. There, code blocks run in per-project NLP Lambdas whose IAM role covers only their own log groups and VPC network interfaces. A fence (code-block egress through the tenant-aware egress service) is follow-up work.
- **Gate:** the product flag `release_scenario_connector_steps`. Self-hosted: steps always run. Cloud: the flag decides. When it is off, setup records "Connector steps are not released for this project yet.", the run ends `ERROR` and Not scored, and no code-runner call is made.
- **Open question for the owner:** the cloud default of the flag. Proposal: on by default, the flag kept as an off switch. Not decided.
- Each step has the ADR-180 budget: 60 s. The child aborts the execute call at the budget, and the code block's own `timeout_ms` is set just under it, so nlpgo stops the code first and reports why. The operator's code-block ceiling can lower it, never raise it. A timeout records `timed_out`.
- No retries, as in ADR-180.

### Outcomes and records

These are unchanged from ADR-180:

- A setup that fails or times out ends the run `ERROR` and Not scored.
- Teardown runs in the `finally`: after a pass, a failure, and a failed setup (with partial state).
- **Rerun and keep data** skips teardown.
- Each hook records status, duration, trace id, state or returned object, and the first 1,000 characters of the error. The code block's traceback is the error, with the step's secrets and run-scoped secrets scrubbed.
- The step's execution runs under the `scenario.setup` or `scenario.teardown` span, so its trace links to the run.
- The run view says the hooks are "Defined in LangWatch". The hint line from https://github.com/langwatch/langwatch/pull/9199 gains this case.

### Fate of the HTTP-agent hooks chain (ADR-188)

**Superseded, with its run-side pieces kept.** Close https://github.com/langwatch/langwatch/pull/8956 (ADR-188), https://github.com/langwatch/langwatch/pull/9193, https://github.com/langwatch/langwatch/pull/9194 and https://github.com/langwatch/langwatch/pull/9195, and close https://github.com/langwatch/langwatch/issues/8955 with a link here. Phase 1 below ports these parts of https://github.com/langwatch/langwatch/pull/9193, with their tests:

- `{{ state }}` and `{{ state.NAME }}` in HTTP turn templates (`modules/scenario/contract/src/http-template-engine.ts`);
- the HTTP-agent hook fields in the target prefetch;
- `adapterDeclaresHooks` covering HTTP agents;
- the `idempotencyKey` shape;
- the narrowing of the spec scenario "HTTP and code agents never call hooks" (`modules/scenario/specs/scenario-run-hooks.feature:222`).

The hooks URL, the signing secret and its rotation, the origin checks, the `packages/webhook-signing` move, the Hooks tab and the HTTP hooks docs are not built.

https://github.com/langwatch/langwatch/pull/9199 (show the hooks a connected agent declares) is about ADR-180 connected agents, not the HTTP transport. It ships on its own.

Why: the code refutes half of the prior lean. The reusable core (when hooks run, the records, timeouts, teardown-always) is real, but it is ADR-180's and **already on main**, so the chain does not need to ship for the Connector to reuse it. What the chain adds that the Connector needs is small: state in turn templates and the prefetch and routing for HTTP agents, about 215 of the 4,210 lines https://github.com/langwatch/langwatch/pull/9193 adds, tests included, plus part of its spec. Most of the rest, about 3,700 lines, is the customer-hosted transport and its security surface: signing, rotation, origin and template checks, generated clients. An optional transport is not free: it is that surface to keep, document and secure, for an option no customer has asked for. The Connector also solves ADR-188's own second motive, Langy in prod, without its open question of where to host a Langy hook service.

What it costs:

- Most of four reviewed PRs is discarded, along with an approved direction.
- An HTTP agent can no longer make test data that only exists inside the customer's network. A connected agent (ADR-180) remains the way to do that.

It is reversible: the branches stay, and a hooks URL can come back later as a second `ScenarioHookCaller` if a customer needs it.

## Rationale / Trade-offs

**Config on the agent, not a new subject.** Setup that makes an account belongs to the agent's API, so every scenario against that agent shares it, as ADR-180's hooks do. Run parameters vary it per scenario. A separate `connector` table in the scenario module would share one Connector across agents, but costs a table, a migration, a link to keep in step, and a second lookup per run, for a need nobody has stated. The field can move into its own table later if that need comes.

**Code blocks, not a declarative request builder.** A list of "POST this, keep that field" steps covers the simple case, but real setup chains calls, reads ids out of answers and branches. A code block already does this, already has an editor with a language service and Langy's propose-and-accept flow (https://github.com/langwatch/langwatch/pull/8991), and already runs in a sandbox. A second, weaker language would be more to build and teach.

**Run-scoped secrets beside state.** ADR-180 asks setup to return references, because state reaches the model provider in prompts. A throwaway account still needs credentials the turns can send. Splitting the output keeps the credentials out of prompts and records, and reuses the existing rule that a run value overrides a project secret.

**Named secrets only.** A step is code that anyone who can edit the agent can write, and it calls out of LangWatch by design. Sending only the secrets it names limits what a careless or hostile step can read. Code agents and Studio code blocks today read every project secret, so this is narrower than what exists.

**Waiting for the WebAssembly runtime (rejected).** Phase 1 would wait for https://github.com/langwatch/langwatch/pull/8991 and offer JavaScript and TypeScript only. But that PR keeps Python on the subprocess runtime by default, so landing it would not fence Python steps anyway. No code block has a network fence today, so steps add no exposure beyond code agents on cloud, and the flag gives a way to hold them back per project. Waiting would delay the feature for no gain in safety.

## Consequences

- The HTTP agent config gains `connector`. Agent save validates the language, the code size, that each secret name exists, and that the dataset exists in the project. The agent form gains a **Connector** tab with two code editors and the secret and dataset pickers.
- `apps/scenario-child` gains `ConnectorHookCaller`. `hookTargetOf` and `adapterDeclaresHooks` cover HTTP agents with a Connector. The run lifecycle, the record schema and the event do not change.
- `modules/scenario/specs/scenario-run-hooks.feature` gains a Connector rule. Error paths included: a setup that throws, one that times out, one over the state cap, a missing secret, a dataset over the cap, a teardown that throws, keep-data, and a secret scrubbed from an error.
- ADR-188 is never accepted on main. ADR-180's "Langy in prod" path becomes a Connector on Langy's HTTP agent.
- The fallback teardown for a killed child (https://github.com/langwatch/langwatch/issues/8781) becomes possible for the first time, since the worker holds the code. It needs setup's state recorded when setup ends, not when the run ends. That is a follow-up, not part of this ADR.
- Nothing stops a step from leaving data behind if its own code is wrong. The `idempotencyKey` tag is how a later sweep would find it.

### Build plan

1. **Platform, no UI.** Does not wait for the WebAssembly runtime. It adds the `connector` config field and its save rules; the ported pieces of https://github.com/langwatch/langwatch/pull/9193; the prefetch of steps, secrets and rows; `ConnectorHookCaller`; and the spec rule with every scenario bound. Set through the agent REST API.

   **Proof** (this is the epic's done-when), on a haven stack with the sim model:
   - A fixture HTTP service stands in for the customer. It has `POST /accounts`, `DELETE /accounts/:id`, `GET /accounts/:id`, and a chat endpoint that answers only for a live account.
   - An HTTP agent with a Connector: setup creates an account and returns its id as state and its token as a run-scoped secret; turns send `{{ state.accountId }}` and `{{ secrets.ACCOUNT_TOKEN }}`; teardown deletes the account.
   - Evidence:
     - the run shows Setup ok and Teardown ok;
     - the fixture's log shows the account was created before turn 1 and deleted after the last turn;
     - `GET /accounts/:id` answers 404 after the run;
     - the token does not appear in the run record or the judge prompt;
     - a second run whose setup throws shows Not scored, and its teardown still runs.

   No customer code.
2. **Form.** The Connector tab, the "Defined in LangWatch" hint, and the docs page section, which replaces https://github.com/langwatch/langwatch/pull/9195.
3. **Langy.**
   - Langy reads the agent's API docs and recent traces, then proposes Connector steps and scenarios through the propose-and-accept flow, applied only when accepted.
   - Langy's own prod dogfood moves its setup and teardown worlds (`dev/dogfood/langy/src/agent.ts:121-139`) into a Connector that calls the LangWatch public API with a project API key secret. The prod scenario sync then runs for real.

## References

- Related ADRs: ADR-128 ([128-connected-agents.md](128-connected-agents.md)), ADR-180 ([180-scenario-run-hooks.md](180-scenario-run-hooks.md)), ADR-188 (https://github.com/langwatch/langwatch/pull/8956, superseded here), ADR-183 on https://github.com/langwatch/langwatch/pull/8991 (code blocks in WebAssembly).
- Epic: https://github.com/langwatch/tasks/issues/1063
- Hooks chain: https://github.com/langwatch/langwatch/issues/8955, https://github.com/langwatch/langwatch/pull/9193, https://github.com/langwatch/langwatch/pull/9194, https://github.com/langwatch/langwatch/pull/9195, https://github.com/langwatch/langwatch/pull/9199
- Code-block isolation: https://github.com/langwatch/langwatch/pull/9050, `specs/nlp-go/code-block.feature`
- Specs: `modules/scenario/specs/scenario-run-hooks.feature`, `specs/scenarios/secret-run-parameters.feature`, `specs/scenarios/scenario-run-parameters.feature`
