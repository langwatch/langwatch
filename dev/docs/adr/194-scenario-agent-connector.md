# ADR-194: Scenario Connector: a new agent type that LangWatch hosts

**Date:** 2026-11-03

**Status:** Proposed

## What the owner asked for

On 2026-10-30 the owner asked for a separate, branded agent type. The words:

- "can we create a little demo for this? I think this would reduce a lot of friction for users, right? they just need to build their APIs?"
- "I think it makes sense to make a custom agent just for this, even though it's technically a code agent maybe, it seems more branded and locked in"
- "also, then we don't have to break code agents by accident"
- The pitch: "Proposing to create a custom scenario connector agent in langwatch for users -- we host the the wrappers for them. reduces a lot of friction. They get the setup/teardown and fixtures right there in the platform -- they just need to decide how to hit their own apis"
- "we already support secrets and all that, so it can be quite secure. But if they want to run it themselves, the sdk are already there."

The earlier draft of this ADR, and https://github.com/langwatch/langwatch/pull/9239 (head 5adee106781), put setup and teardown steps on the HTTP agent. The owner said that "is not what was discussed". This ADR replaces that design.

## Context

A scenario often needs test data that exists before the first turn and is removed after the last: a throwaway account, an order to refund. Today both ways to make it put code in the customer's hands:

- **Connected agents** (ADR-180, [180-scenario-run-hooks.md](180-scenario-run-hooks.md)): setup and teardown are functions in the customer's process, which must stay online.
- **HTTP agents** (ADR-188, proposed on https://github.com/langwatch/langwatch/pull/8956, built on https://github.com/langwatch/langwatch/pull/9193, https://github.com/langwatch/langwatch/pull/9194 and https://github.com/langwatch/langwatch/pull/9195; not on main): a hooks URL the customer hosts, signed by LangWatch.

Epic: https://github.com/langwatch/tasks/issues/1063.

**The HTTP hooks chain is parked, not dropped.** On 2026-11-10 https://github.com/langwatch/langwatch/pull/8956, https://github.com/langwatch/langwatch/pull/9193, https://github.com/langwatch/langwatch/pull/9194, https://github.com/langwatch/langwatch/pull/9195 and https://github.com/langwatch/langwatch/pull/9239 were closed with a "parked, reopen any time" note; https://github.com/langwatch/langwatch/issues/8955 stays open. The Connector does not need them and does not touch the HTTP agent, and nothing in this ADR blocks them: if a customer asks for a hooks URL they host, the chain is reopened beside the Connector.

What main has, and the Connector reuses:

- **The hook lifecycle is on main and is caller-agnostic.** `ScenarioRunHooksService.around` runs setup, the turns, then teardown in a `finally`, records each hook, and never lets teardown change the score (`apps/scenario-child/src/services/scenario-run-hooks.service.ts:100-115`). It calls hooks through a two-member interface, `ScenarioHookCaller { runState; callHook({ kind, timeoutMs }) }` (`:20-23`). Only the wiring picks connected agents: `hookTargetOf` returns null for any other agent type (`apps/scenario-child/src/services/scenario-child-execution.service.ts:209-222`).
- **The record is on main.** `ScenarioHookResult` with statuses `ok | failed | timed_out | skipped | not_run`, the 60 s `DEFAULT_HOOK_TIMEOUT_MS`, and "Not scored" when setup is not `ok` (`modules/scenario/contract/src/features/execution/scenario-hooks.ts:11,17,56-59`); the `lw.simulation_run.hooks_recorded` event (`modules/scenario/process/src/eventing/simulation-processing.commands.ts:115`); the Setup and Teardown bands on the run.
- **Code execution from a scenario run is on main.** A code agent's turn runs as a one-node `entry -> code -> end` workflow on nlpgo's `/go/studio/execute_sync` (`apps/scenario-child/src/channels/http/http.serialized-code-agent.channel.ts:208,376`), with project secrets as the `secrets` namespace, resolved by the prefetch (`modules/scenario/process/src/features/prefetch/services/scenario-target-prefetch.service.ts:175-192`) through `SecretApi.getValuesByName` (`modules/secret/contract/src/secret.api.ts:28`).
- **Code-block isolation.** https://github.com/langwatch/langwatch/pull/9050 (merged) isolates one execution from another inside nlpgo. The app-level rule that a code block gets no network unless its workflow declares it is not built: `specs/security/tenant-aware-egress-isolation.feature` marks "A code block is denied network access by default" as `@unimplemented`. On cloud, the code-block runner's network is fenced by port at the infrastructure level; a fence by address is not built. Self-hosted, the Python subprocess runtime still lets a block open any socket (`specs/nlp-go/code-block.feature:336-340`). https://github.com/langwatch/langwatch/pull/8991 (open, not on main; its ADR-183) adds a WebAssembly runtime for JavaScript and TypeScript code blocks, but keeps Python on the subprocess runtime by default (WebAssembly is opt-in through `NLPGO_ENGINE_CODE_BLOCK_RUNTIME=wasm`).
- **Datasets** are read through `DatasetApi.getDatasetPage` (`modules/dataset/contract/src/dataset.api.ts:153`).

How agent types are defined today:

- `agentTypeSchema` is an enum of six types, and `agentConfigSchema` is a discriminated union on `type` (`modules/agent/contract/src/config/index.ts`). Each type has its own config file beside it (`code.ts`, `http.ts`, `connected.ts`, `voice.ts`, `signature.ts`). `modules/agent/contract/src/agent.ts` repeats the `type` literal in its create and read shapes.
- The scenario child picks a target from one table, `SERIALIZED_AGENT_RUNTIMES` (`apps/scenario-child/src/channels/serialized-agent-channels.registry.ts`). Each row names an input schema, a factory, a resource class and a stop signal. Its header says a new runtime is a new row. The data schemas live in `modules/scenario/contract/src/scenario-execution-data.ts`, the resource classes in `modules/scenario/contract/src/scenario-resource-class.ts`.
- The UI lists types in `modules/agent/browser/src/ui/sections/agent-type-selector-drawer.tsx`; code and HTTP agents have their own editor drawers beside it.

## Decision

We will add a new agent type, **Scenario Connector** (`type: "connector"`), next to `code`, `http` and `connected`. The existing types do not change: no edit to the code or HTTP config schema, editor or runner target.

### What the user writes

Only how to reach their own API, in three places:

- **Call** (required): a code block. It gets the scenario's message and the run state, sends it to the customer's API, and returns the reply.
- **Setup** and **teardown** (optional): code blocks. Setup makes test data and returns a state, for example the id of a created account. Teardown removes it.
- **Secrets and fixtures**: the project secrets the blocks may read (from the secrets manager), and an optional fixtures dataset whose rows setup can use.

LangWatch stores the blocks, hosts the wrapper around them, and runs them. The customer hosts nothing. A customer who wants to run it on their own side still has the SDKs (ADR-128).

### Config and ownership

- **The agent module owns the config.** A new file `modules/agent/contract/src/config/connector.ts` beside `http.ts`, a new member of `agentTypeSchema`, `agentConfigSchema` and `parseAgentConfig`, and the matching `type` literals in `agent.ts`. It lives in the agent's existing JSON config column: no table, no migration.

  ```text
  connectorAgentConfig = {
    ...baseAgentConfig,
    call: Block;
    setup?: Block;
    teardown?: Block;
    secretNames: string[];   // project secrets the blocks may read; nothing else travels
    fixturesDatasetId?: string;
    timeoutMs?: number;
  }
  Block = { language: "python"; code: string }   // 64 KiB cap
  ```

- **The scenario module owns run behaviour.** The target prefetch (`modules/scenario/process/src/features/prefetch/services/scenario-target-prefetch.service.ts`) reads the agent through `AgentApi`, the named secrets through `SecretApi.getValuesByName`, and the fixture rows through `DatasetApi.getDatasetPage`. It puts them on a new `ConnectorAgentData` in `scenario-execution-data.ts`. `adapterDeclaresHooks` (`modules/scenario/process/src/rules/scenario-run-hooks.rules.ts`) counts a connector agent with a setup or teardown block as hooked.
- **The child gets its own target.** A new row `connector` in `SERIALIZED_AGENT_RUNTIMES`, a new `TARGET_RESOURCE_CLASS` and stop signal, and a new channel `HttpSerializedConnectorAgentChannel` beside `http.serialized-code-agent.channel.ts`. `hookTargetOf` (`scenario-child-execution.service.ts`) returns the connector's hook caller for this type.

### How a run goes

1. Setup (if set) runs as a one-node code workflow on nlpgo's `/go/studio/execute_sync`, the transport a code agent turn uses. It returns `{ state, secrets? }`.
2. Each turn runs the **call** block the same way, with the message, the history, the run state and the run-scoped secrets. It returns the reply text.
3. Teardown (if set) runs in a `finally`, with the state setup returned, even when setup failed (with partial state), a turn failed, or the run was stopped.

State and run-scoped secrets follow ADR-180 and the earlier draft of this ADR:

- Setup returns `state` (a JSON object, 64 KiB cap). Call and teardown receive it. The simulated user and the judge may see it, so it holds ids, not credentials.
- Setup may also return `secrets` (name to string). They override a project secret of the same name for this run only. Call and teardown receive them. They are never recorded and never shown to the simulated user or the judge, and are scrubbed from every error and transcript.
- Any other top-level key in setup's answer fails setup with an error naming the key.
- **State never chooses a host.** The customer's base URL is a config field or a project secret, never read from `state`, so setup cannot point the run's secrets at another host.
- The input also carries `run`, `params`, `rows` (the fixture rows, 64 KiB cap, over it fails the step) and `idempotencyKey` `<scenarioRunId>:<attemptId>:<kind>`, so a block can tag the data it makes and a sweep can find leftovers.
- Each block gets only the secrets in `secretNames`, fewer than a code agent gets today.

### Lifecycle, records and timeouts

This plugs into the lifecycle on main (ADR-180) and does not change it: `ScenarioRunHooksService.around`, the `ScenarioHookResult` record, the `lw.simulation_run.hooks_recorded` event and the Setup and Teardown bands.

- Setup that fails or times out ends the run `ERROR` and Not scored. Teardown never changes the score.
- Each hook has the 60 s budget (`DEFAULT_HOOK_TIMEOUT_MS`). The child aborts the execute call at the budget; the block's own `timeout_ms` is set 5 s under it, so nlpgo reports why. No retries.
- **Rerun and keep data** skips teardown.
- Each hook records status, duration, trace id, state or returned object, and the first 1,000 characters of the error, scrubbed of secrets.

### Isolation and egress

Blocks run only in nlpgo's code-block sandbox, never in the worker or the child. The Connector adds no egress exposure beyond a code agent: on cloud the code runner's network is fenced by port at the infrastructure level; a fence by address is not built. The app-level fence is not built (`specs/security/tenant-aware-egress-isolation.feature`, `@unimplemented`), and self-hosted Python can still open any socket. A fence is follow-up work. The WebAssembly runtime (https://github.com/langwatch/langwatch/pull/8991) is not a precondition.

**Gate:** the product flag `release_scenario_connector_steps` (the owner asked for the Connector behind a feature flag). Whether it gates self-hosted too, and its cloud default, are open questions below. When off, the connector agent's hooks and calls record "Connector steps are not released for this project yet.", the run ends `ERROR` and Not scored, and no code-runner call is made.

### Open questions for the owner

They stay open. This ADR does not decide them.

- **Self-hosted gate.** Does the flag gate self-hosted too? Proposal: yes, default on there, so it can be switched off anywhere.
- **The cloud default of the flag.** Proposal: off, turned on per project, until code blocks get an address fence. Cost: each cloud project needs turning on.

## What is reused, and from where

**From https://github.com/langwatch/langwatch/pull/9239** (read only; the HTTP agent change is dropped):

- `apps/scenario-child/src/rules/connector-step.rules.ts`: the `entry -> code -> end` workflow builder, secrets riding `workflow.secrets`, the idempotency key, the missing-secret refusal, the answer shape check, the timeout headroom, `scrubbedJson`. The step input gains `message` and `history` for the call block.
- `apps/scenario-child/src/services/scenario-connector-hooks.service.ts`: a `ScenarioHookCaller` that runs a step, keeps setup's state and run-scoped secrets, and scrubs every value it hands on. It becomes the caller `hookTargetOf` returns.
- `apps/scenario-child/src/channels/http/http.connector-hook.channel.ts`: one `execute_flow` POST per step over `ExecuteSyncTransport`, with abort at the budget and every failure mapped to the step's error.

**From the 2026-10-30 prototype 86a56a08640** (`api_agent`, never finished; viewable with `git show 86a56a08640:<path>`):

- `modules/agent/contract/src/config/api-agent.ts`: the right shape for the config (base URL, key, turn, setup, teardown, fixtures dataset). Rename to `connector`; add `secretNames`; the dataset reaches the blocks.
- `apps/scenario-child/src/channels/http/http.serialized-api-agent.channel.ts` and `rules/api-agent.rules.ts`: the own-channel-for-a-new-type pattern, and the turn running as a block. The prototype's registry row, browser wiring (`agent-card.tsx`, `get-agent-editor-drawer.ts`) and `hookTargetOf` change are the file list for the new type.

Not reused: the HTTP agent `connector` field, the `{{ state }}` turn templates in HTTP agents, and anything in the ADR-188 chain, which stays parked (see above).

## Rationale / Trade-offs

**A separate type, not steps on the HTTP agent.** The owner asked for it: branded, locked in, and code and HTTP agents cannot break by accident. It also makes the call a block too, so the whole thing is one thing the user edits, and the HTTP template engine stays as it is.

**Code blocks, not a declarative request builder.** Real setup chains calls, reads ids out of answers and branches. A code block already does this, has an editor and Langy's propose-and-accept flow, and runs in a sandbox.

**Run-scoped secrets beside state.** State reaches the model provider in prompts. A throwaway account still needs credentials the calls can send. Splitting the output keeps credentials out of prompts and records.

**Named secrets only.** A block is code that anyone who can edit the agent can write, and it calls out of LangWatch by design. Sending only the secrets it names limits what a careless or hostile block can read.

**It costs:** a sixth agent type to carry through the module, the child, the form and the docs; and a customer's API must be reachable from the code runner (public HTTPS on cloud). Test data that exists only inside a private network still needs a connected agent.

## Consequences

- New: `connector` in the agent type enum, the config file, the `ConnectorAgentData` schema, the registry row, the channel, and an agent form with its own icon in the type picker.
- Unchanged: code, HTTP and connected agents (config, editor, target), the hook lifecycle, the record schema and the event.
- Specs: `modules/scenario/specs/scenario-run-hooks.feature` gains a Connector rule, error paths included (setup throws, times out, state over the cap, missing secret, dataset over the cap, teardown throws, keep-data, secret scrubbed from an error), and a new agent spec under `modules/agent/specs/`.
- Nothing stops a block leaving data behind if its own code is wrong. The `idempotencyKey` tag is how a later sweep finds it.
- The fallback teardown for a killed child (https://github.com/langwatch/langwatch/issues/8781) becomes possible, since the worker holds the code. Follow-up.

### Build plan

1. **Contract and runner, no UI.** Config file, enum, `agent.ts` literals, `ConnectorAgentData`, prefetch, registry row, channel, hook caller (ported from 9239), flag, specs. Create the agent through the agent REST API.
2. **Form.** Agent type picker card and icon, the editor drawer (call, setup, teardown editors, secret picker, dataset picker), the "Defined in LangWatch" hint on the run view, docs.
3. **Langy.** Langy proposes connector blocks from the API docs and traces through propose-and-accept; Langy's prod dogfood (`dev/dogfood/langy/src/agent.ts`) moves its setup and teardown into a connector.

## Proof

On a haven stack with the sim model, no customer code:

- A fixture HTTP service stands in for the customer: `POST /accounts`, `DELETE /accounts/:id`, `GET /accounts/:id`, and a chat endpoint that answers only for a live account.
- A connector agent: setup creates an account through that API and returns its id as state and its token as a run-scoped secret; call sends the message with the token; teardown deletes the account.
- Evidence: the run shows Setup ok and Teardown ok; the fixture log shows create before turn 1 and delete after the last turn; `GET /accounts/:id` is 404 afterwards; the token appears in no run record, log, trace or AI prompt (simulated user, judge); a second run whose setup throws shows Not scored and its teardown still runs.
- A code agent and an HTTP agent scenario run unchanged in the same stack, and their saved configs are byte-identical before and after.

## References

- Related ADRs: ADR-128 ([128-connected-agents.md](128-connected-agents.md)), ADR-180 ([180-scenario-run-hooks.md](180-scenario-run-hooks.md)), ADR-188 (https://github.com/langwatch/langwatch/pull/8956), ADR-183 on https://github.com/langwatch/langwatch/pull/8991 (code blocks in WebAssembly).
- Epic: https://github.com/langwatch/tasks/issues/1063. Earlier attempt: https://github.com/langwatch/langwatch/pull/9239.
- Code-block isolation: https://github.com/langwatch/langwatch/pull/9050, `specs/nlp-go/code-block.feature`.
- Specs: `modules/scenario/specs/scenario-run-hooks.feature`, `specs/scenarios/secret-run-parameters.feature`, `specs/scenarios/scenario-run-parameters.feature`.
