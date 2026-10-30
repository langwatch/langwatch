# ADR-188: pi as a natively instrumented coding agent

**Date:** 2026-10-26

**Status:** Proposed

> `langwatch pi` is a first-class wrapped tool on the ingestion path only. pi already declares its own
> span tree (`pi.harness.run` → `turn` → `tool`, `pi.ai.request`) in `@earendil-works/pi-telemetry`, but
> its CLI binds that contract to a no-op backend and exposes no OTel environment. We install a thin
> first-party extension that emits pi's own declared names and attributes over the standard
> `OTEL_EXPORTER_OTLP_*` environment, dual-written to GenAI semantic conventions. The server side is one
> declarative definition beside `codex.ts`. The extension is a shim with a death date: when pi wires its
> native `TelemetryContext` into the CLI, the file is deleted and the receiver does not change.

## Context

pi (`@earendil-works/pi-coding-agent`) is a coding agent with a terminal UI, a TypeScript extension API
and its own provider abstraction. It is not tracked today: it is absent from `codingAgentSchema`
(`modules/coding-agent/contract/src/telemetry/coding-agent-definition.ts`), from the definition registry
(`telemetry/index.ts`), from the wrapper subcommands (`sdks/typescript/src/cli/utils/governance/tool-env.ts`),
from the assistant presets and from `specs/coding-agent/`.

A separate, merged use of pi exists and is **out of scope here**: `services/langyagent/adapters/pi/` runs
pi in-process as one of Langy's harnesses (`modules/langy/contract/src/langy.ts`, `harness: z.enum(["opencode","pi"])`).
That is our own product internals, not a customer's coding agent. Nothing in this record touches
`modules/langy` or `services/langy*`. It matters only as evidence: vendoring `@earendil-works/pi-agent-core`
is how pi's telemetry contract was read.

Research (2026-10-26, verified against the published packages and `pi.dev/docs/latest/extensions`):

- **pi declares a span tree, first-party.** `@earendil-works/pi-telemetry` exports a `TelemetryContext` /
  `TelemetrySpan` contract and a declarative schema system (`defineTelemetrySchema`, with
  `TelemetryParentDefinition` of `any` / `root_or_external` / `spans`).
  `@earendil-works/pi-agent-core`'s `AI_TELEMETRY_SCHEMA` and `HARNESS_TELEMETRY_SCHEMA` declare the whole
  tree: `pi.harness.run` (root or external parent, carrying `pi.session.id`, `pi.lane.name`,
  `pi.operation.{id,kind,recovery}`, ending on `pi.operation.outcome`), `pi.harness.turn` (parent `run`,
  carrying `pi.turn.id`), `pi.harness.tool` (parents `turn`/`run`, carrying `pi.tool.{name,call_id,replay}`,
  ending on `pi.tool.is_error`), `pi.harness.step`, `pi.harness.checkpoint`, `pi.harness.compaction`,
  `pi.harness.hook`, `pi.harness.sleep`, `pi.harness.event_handler`, `pi.session.write`, and
  `pi.ai.request` (carrying `pi.ai.{provider,model,api,operation}`, `pi.ai.response.{model,id,stop_reason}`,
  `pi.ai.usage.{input,output,cache_read,cache_write,reasoning,total}_tokens`, `pi.ai.usage.cost`,
  `pi.ai.stream.{chunk_count,time_to_first_chunk_ms}`, `pi.ai.error.type`).
- **The provider dialects are already flattened, upstream of us.** There is one `pi.ai.request` span with
  provider as an *attribute*, one closed cross-provider `stop_reason` enum
  (`stop|length|tool_use|error|aborted|deferred`), and one token taxonomy with cache and reasoning tokens
  first-class. pi's `@earendil-works/pi-ai` layer did the normalisation that we paid for three times over
  for Claude Code, Codex and Gemini. We consume one dialect, not one per model vendor.
- **The contract has no backend in the CLI.** `pi-telemetry` ships `NOOP_TELEMETRY_CONTEXT` and
  `InMemoryTelemetryContext` and no exporter. Greps of the published CLI at 0.84.2 and at 1.4.0 find no
  `OTEL_*` variable at all, and no `telemetryContext` on the CLI's public surface; the only pi-owned
  telemetry variable is `PI_TELEMETRY`, which is the install-analytics opt-out
  (`dist/core/telemetry.js`, `dist/cli/args.js`). In-process embedders can pass a context to
  `startHarnessSpan`; a CLI user cannot.
- **There is no pi 2.0.** `npm view @earendil-works/pi-coding-agent` gives latest `1.4.0`; the 2.x
  versions seen in the wild belong to a third-party plugin bundle. Nothing on the changelog adds OTel export.
- **The extension API is rich enough and is observe-only where we need it.** Extensions are TypeScript
  files in `~/.pi/agent/extensions/`, default-exporting a function that receives the API and registers
  `pi.on(event, handler)`. The documented order is
  `input → before_agent_start → agent_start → (turn_start → message_* → tool_call → tool_execution_* → tool_result → turn_end)× → agent_end → agent_settled`.
  `turn_start` carries `turnIndex`; `turn_end` carries an `outcome` of `completed|aborted|error`;
  tool events carry `usage` from the execution itself; `after_provider_response` and
  `provider_stream_event` carry the model call's usage, and the model registry carries per-million-token
  `cost` rates. `getContextUsage()` exposes context occupancy.
- **Community extensions export the wrong shape.** The two maintained OTel extensions emit metrics and
  **log records** (one in a Claude Code dialect with `claude_code.` swapped for `pi.`, one in GenAI
  convention logs); a third derives traces from hooks and invents its own parentage. None emits pi's
  declared harness tree, which is what a session trace in the explorer is made of.

Constraints at framing: no double trace; pi reuses the existing wrapper machinery, no parallel wrapper;
everything persisted is removable by `langwatch logout`; no third-party code is installed into a
developer's session by us (ADR-039 §7 and the claude/opencode plugin precedent — we ship our own
plugins); customer trace routing is never configured through LangWatch's own `OTEL_*` namespace
(ADR-175 §1 governs LangWatch processes; wrapped children are a separate, existing injection path).

## Decision

1. **Tool integration on the ingestion path only; no gateway path for pi.** `langwatch pi` registers
   alongside the other five in `sdks/typescript/src/cli/program.ts` → `wrap.ts` → `runWrapped("pi")`.
   `PLATFORM_TOOL_POLICY_DEFAULTS.pi` is `allowVk: false, allowOtelDirect: true`, so
   `resolveWrapperPath` finds a single allowed path and never prompts. Rejects a gateway path: every
   model's address is fixed in pi's own build, so there is no base-URL swap to make, and a half-wired
   `--tool-mode gateway` that cannot work is worse than an absent one.

2. **The coding-agent id is `pi`; the ingestion sourceType slug is `pi_cli`.** `pi` joins
   `codingAgentSchema` and gets `telemetry/pi.ts` in the definition registry. The slug follows the
   `copilot_cli` precedent because a pi VS Code extension exists and would otherwise collide, and because
   `pi` as a bare governance slug reads as a unit, not a tool. The command stays `pi`; slug ≠ command is
   the established `claude` → `claude_code` shape.

3. **`matches()` tests pi's own span namespace, never a service name we stamped ourselves.**
   `pi`'s definition matches on `signal.name.startsWith("pi.")` and nothing else. The shared
   `signalSays` helper is deliberately **not** used: `pi` is a substring of `anthropic`, `copilot` and
   `openai`, so a substring test over names, scopes and service names would claim other agents' spans.
   A test on `service.name` alone would be a tautology, since the wrapper is what sets it.

4. **We ship our own extension, as a first-party shim, and install no third-party package.**
   `langwatch pi` writes `pi-plugin.ts` into pi's extension directory, registered in
   `telemetry-targets.ts` so `langwatch logout` removes it, exactly as `claude-plugin.ts` and
   `opencode-plugin.ts` are. Rejects adopting a community extension: it would export logs rather than
   pi's span tree (reopening the problem this record closes), and `langwatch pi` installing someone
   else's code in-process into a session holding live credentials is a supply-chain hop we would be
   imposing under our own brand. Pinning and auditing each release of a single-maintainer package is
   maintenance too, just maintenance we do not control.

5. **The shim emits pi's declared vocabulary, with its declared parentage.** Because the CLI exposes no
   `TelemetryContext` to extensions, the shim builds the spans itself with the OTel JS SDK, using pi's
   **names and attribute keys verbatim**: one `pi.harness.run` per `agent_start`/`agent_end` carrying
   `pi.session.id`, a child `pi.harness.turn` per `turn_start`/`turn_end` carrying `pi.turn.id` and
   ending on the documented outcome, a `pi.harness.tool` per `tool_execution_start`/`_end` carrying
   `pi.tool.name` and `pi.tool.call_id` and ending on `pi.tool.is_error`, and a `pi.ai.request` per
   provider response carrying the full `pi.ai.*` attribute set. Rejects inventing a LangWatch-private
   event scope: speaking pi's own vocabulary is what makes the shim deletable and the receiver stable.
   We are the transport, never the author of the names.

6. **Every model-call attribute is dual-written in GenAI semantic conventions.** The shim writes
   `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.response.model`, `gen_ai.system` and
   `gen_ai.usage.{input,output}_tokens` beside the `pi.ai.*` keys on the same span. This is the lever that
   keeps the server side declarative: the generic GenAI arms of
   `coding-agent-span.ts`, `coding-agent-span-filter.ts`, `coding-agent-model-call-facts.rules.ts` and
   `gen-ai-operations.ts` then admit, fold and price pi with no pi-specific branch. The `pi.*` keys stay
   because they carry what the conventions have no name for: cache-write tokens, reasoning tokens,
   deferred operations, time to first chunk, and pi's reported cost.

7. **Reported cost wins; the catalogue is the fallback.** pi reports `pi.ai.usage.cost` on a span, a
   combination the pipeline has not met: span-fed agents are priced from the catalogue, log-fed agents
   report their own cost. pi is span-fed **and** self-reporting, so cost precedence is explicit — the
   reported figure is used when present, and catalogue pricing from the dual-written `gen_ai.usage.*` is
   used when pi gives no cost for that model. This is Claude Code's precedence rule arriving on a span
   instead of a log record. `pi` joins `SPAN_FED_MODEL_CALL_AGENT_IDS` via `modelCallsOnSpansOnly: true`
   and declares no `nanoAiUnitAttributes`, because pi sells no unit of its own.

8. **The session key is pi's own session id.** `deriveSessionKeyFromSpan` reads `pi.session.id` from
   `pi.harness.run`, and `sessionSpanNames` is `["pi.harness.run"]`. `spansRequireSessionKey` is true:
   a pi span with no resolvable session is dropped rather than keyed on its trace id, because pi's own
   tree already guarantees the attribute on the root and a missing one means the span did not come from
   our shim. `logsRequireSessionKey` is irrelevant and `logsOnly` is false — pi emits no log records at all.

9. **Short runs are flushed before exit.** A non-interactive `pi -p` run can finish well inside a batch
   window, so the shim force-flushes the span processor on `agent_end` and again on `agent_settled`,
   under a bounded timeout, and never blocks pi's exit on a slow endpoint. Rejects relying on the
   default periodic flush, which is the whole "pi shows nothing" failure class for one-shot runs.

10. **Repository, branch and pull requests ride the existing paths, unchanged.** Git context arrives
    through the session context hook that copilot already uses
    (`specs/ai-governance/cli-wrappers/session-context-hook.feature`), and pull-request linkage follows
    from sessions plus that context through the existing machinery
    (`specs/coding-agent/pull-request-linkage.feature`). `ingestSourceType("pi")` maps to `pi_cli` so the
    billable lookup resolves; a missing arm there silently prices a session against the wrong source.

11. **Community extensions are accepted as compatibility, never as a dependency.** pi's definition
    carries `eventAliases` and `metricAliases` entries for the signal names the two maintained community
    extensions emit, so a customer already running one still lands in the trace explorer. Nothing is
    installed, nothing is audited, and the aliases are data in the definition, not a code path.

12. **The shim has a death date.** When pi wires its native `TelemetryContext` into the CLI, or ships
    `OTEL_*` support, `buildOtelEnvBlock("pi")` keeps its standard variables, `pi-plugin.ts` is deleted,
    and the definition, the canonicalisation, the projections and the billing arm do not change — because
    they were only ever reading pi's own declared names.

## Constants

| Name | Value | Purpose |
| --- | --- | --- |
| Tool command | `pi` | `langwatch pi` wrapper subcommand; child binary name |
| Coding-agent id | `pi` | `codingAgentSchema`; `telemetry/pi.ts` definition id |
| sourceType slug | `pi_cli` | ingest-key provenance; `SOURCE_TYPE_BY_TOOL.pi`; `ingestSourceType("pi")` |
| Assistant kind | `pi` | `KnownAssistantKind`, `ASSISTANT_PRESETS`, icon and tile |
| Platform tool slug | `pi` | `PLATFORM_TOOL_SLUGS`; policy defaults below |
| `OTEL_RESOURCE_ATTRIBUTES` | `service.name=pi` | analytics grouping only; never the match test (Decision 3) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/json` | matches the receiver default, as for copilot |
| `OTEL_TRACES_EXPORTER` | `otlp` | spans are pi's only signal |
| `OTEL_LOGS_EXPORTER`, `OTEL_METRICS_EXPORTER` | `none` | pi emits neither; an unset value would start idle exporters |
| Session root span | `pi.harness.run` | `sessionSpanNames`; carries `pi.session.id` |
| Session key attribute | `pi.session.id` | `deriveSessionKeyFromSpan` |
| Model call span | `pi.ai.request` | span-fed model calls, dual-written to `gen_ai.*` |
| Reported cost attribute | `pi.ai.usage.cost` | preferred over catalogue pricing (Decision 7) |
| Extension file | `pi-plugin.ts` in pi's extension directory | first-party shim; registered in `telemetry-targets.ts` |
| Platform policy defaults | `allowVk: false, allowOtelDirect: true` | ingestion only (Decision 1) |
| Verified against | pi `1.4.0` | published types and extension docs read at framing |
| Min. warned version | `1.0.0` | first stable line carrying the documented extension events |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
| --- | --- | --- |
| No double trace | A pi run never produces both our shim's spans and a second capture of the same calls | no gateway path exists for pi (Decision 1); the shim is idempotent on install and a second install does not double-register handlers |
| We never author pi's names | Every span name and attribute key we emit is one pi declares | a conformance test asserts the shim's emitted keys are a subset of pi's declared schema, so an upstream rename fails the build rather than silently drifting |
| No agent claims another's spans | `matches()` admits `pi.*` and nothing else | unit test: an `anthropic`, `copilot` and `openai` signal is not matched as pi, which a `signalSays` test would fail (Decision 3) |
| Logout symmetry | Every persisted artifact is discoverable and removable | `pi-plugin.ts` registered in `scanTelemetryTargets()`; env vars via `telemetryEnvVarNames("pi")`; extend `specs/ai-governance/cli-wrappers/logout.feature` |
| Ingestion is wired, not fallthrough | `SOURCE_TYPE_BY_TOOL.pi` exists | unit test: pi resolves to ingestion and mints a `pi_cli` key, and never returns a gateway shape |
| Billing resolves to a real source | `ingestSourceType("pi")` returns `pi_cli` | unit test on the pull-request usage service: a pi session's billable lookup resolves, and reported cost is preferred over catalogue pricing |
| A one-shot run is not lost | `pi -p` exports before the process ends | test anchor: a run whose spans close inside one flush window still exports, and a dead endpoint does not delay exit past the bounded timeout |
| The shim is deletable | Removing the extension changes no server code | the definition, canonicaliser and projections read only pi's declared names; no test references `pi-plugin.ts` from the server side |

## Alternatives considered

- **Tail pi's session JSONL file**, as a prior attempt did: it makes LangWatch the producer of facts pi
  already produces, forces a cursor, a retry buffer, an exit sweep and a resume dedup, and converges on
  nothing when pi ships its own export. The fork tree pi records in those files (`id`/`parentId`) is
  evidence that parentage was available all along.
- **Adopt a community OTel extension** as a dependency: no span tree, and an installed third-party
  package in-process beside live credentials. Taken as compatibility aliases instead (Decision 11).
- **Emit a LangWatch-private namespace** (`langwatch.pi.*`): easy to write, permanently divergent from
  pi's own export, and every server-side reader would have to be unwound later.
- **Wait for pi to ship native OTel**: free, but unscheduled, and pi's declared schema is stable enough
  to speak today.
- **Instrument through `pi-agent-core` in-process**, as Langy's harness could: works for our worker, and
  is irrelevant to a customer running the CLI on their own machine.

## References

- Related ADRs: ADR-039 (copilot as a tracked coding assistant, the integration shape), ADR-018
  (unified observability substrate), ADR-056 (coding-agent pipeline and session aggregate), ADR-132
  (secrets are not config), ADR-161 (an agent session is a principal), ADR-175 (standard OTel environment)
- `specs/coding-agent/pi-sessions.feature`, `specs/coding-agent/pi-model-calls.feature`,
  `specs/ai-governance/cli-wrappers/pi-env-injection.feature`,
  `specs/ai-governance/cli-wrappers/pi-extension-install.feature`,
  `specs/ai-governance/ingestion-sources/pi-cli-otlp.feature`
- Extended rather than added: `specs/ai-governance/cli-wrappers/logout.feature`,
  `specs/ai-governance/cli-wrappers/wrap-path-choice.feature`,
  `specs/ai-governance/cli-wrappers/cli-mints-ingest-key.feature`,
  `specs/ai-governance/cli-wrappers/wrapper-help-passthrough.feature`,
  `specs/ai-governance/cli-wrappers/session-context-hook.feature`,
  `specs/coding-agent/terminal-view.feature`, `specs/coding-agent/sessions-screen.feature`,
  `specs/coding-agent/pull-request-linkage.feature`, `specs/coding-agent/personal-usage.feature`,
  `specs/api-keys/unified-api-keys.feature`, `specs/trace-processing/coding-agent-cost.feature`
- `@earendil-works/pi-telemetry` (span contract and schema system),
  `@earendil-works/pi-agent-core` `dist/harness/telemetry.d.ts` (the declared tree)
- `pi.dev/docs/latest/extensions` (extension API and event order)
