# ADR-188: pi as a natively instrumented coding agent

**Date:** 2026-10-26

**Status:** Proposed

> `langwatch pi` is a first-class wrapped tool on the ingestion path only. pi already declares its own
> span tree (`pi.harness.run` → `turn` → `tool`, `pi.ai.request`): the contract lives in
> `@earendil-works/pi-telemetry` and the schemas that declare the tree in
> `@earendil-works/pi-agent-core`. Its CLI binds that contract to a no-op backend and exposes no OTel
> environment. We install a thin first-party extension that emits pi's own declared names and attributes
> over the standard `OTEL_EXPORTER_OTLP_*` environment, dual-written to GenAI semantic conventions. The
> server side is one declarative definition beside `codex.ts`. The extension is a shim with a death date:
> when pi wires its native `TelemetryContext` into the CLI, the file is deleted and the receiver does not
> change. Every version claim in this record is pinned to pi `0.84.2`, the version this workspace resolves.

## Context

pi (`@earendil-works/pi-coding-agent`) is a coding agent with a terminal UI, a TypeScript extension API
and its own provider abstraction. It is not tracked today: it is absent from `codingAgentSchema`
(`modules/coding-agent/contract/src/telemetry/coding-agent-definition.ts`), from the definition registry
(`telemetry/index.ts`), from the wrapper subcommands (`sdks/typescript/src/cli/utils/governance/tool-env.ts`),
from the assistant presets and from `specs/coding-agent/`.

A separate, merged use of pi exists and is **out of scope here**. Both of the earlier drafts described it
wrongly, in opposite directions, so here is the shape as the code has it. Go's `langyagent` does not spawn
the pi CLI. It spawns our own first-party binary: `services/langyagent/adapters/pi/spawn.go` runs
`in.BinaryPath` (`:329`) and names the failure `start langy-worker` (`:342`), and that binary is
`services/langyworker` compiled to one file (`package.json:48`, output `.bin/langy-worker/langy-worker`).
That worker **does** embed pi in-process, as a library: it depends on `@earendil-works/pi-coding-agent`
and `@earendil-works/pi-ai`, both pinned `0.84.2` (`package.json:17-18`), and builds sessions against pi's
extension API directly (`services/langyworker/src/session.ts:73`, `factory: (pi: ExtensionAPI) => {`).
Paths in this paragraph are relative to `services/langyworker` unless given in full. So the first draft's
"embeds pi's telemetry contract in-process" was half right and the correction that replaced it was half
wrong: pi is embedded, but its _telemetry_ contract is not. Nothing under `services/langyworker/src`
references `pi-telemetry`, `TelemetryContext`, `OTEL_*` or `@opentelemetry`, and the Go adapter spells the
reason out in a comment before it builds the child environment: "NO OTLP export variables: pi exports no
OTLP (the LLM relay synthesizes the gen_ai spans instead)" (`spawn.go:382-383`). A test holds the environment
to it ("No OTLP export (pi exports none)", `services/langyagent/adapters/pi/spawn_test.go:403`, which
fails on any key with an `OTEL_` prefix).

That is our own product internals, not a customer's coding agent, and nothing in this record touches
`modules/langy` or `services/langy*`: pi's telemetry contract was read from the published packages, not
from Langy's dependency on them. The residual risk is sharper than "if Langy's worker ever gains an
exporter", though, and it is worth stating plainly. Langy's worker is a Node process that already holds
`LANGWATCH_API_KEY`, `LANGWATCH_ENDPOINT` and `LANGWATCH_PROJECT_ID` in its environment
(`spawn.go:409-415`), so the day anything in that process starts an OTel SDK (a pi release that wires its
own `TelemetryContext`, a dependency that auto-instruments, or someone adding tracing to the worker for
unrelated reasons) it is already pointed at a real project and will export `pi.*` spans without a single
deliberate decision. The Go-side test guards only the variables the adapter sets; it cannot see an
exporter configured in TypeScript. Decision 13 is the guard that holds in that case, because it lives in
our own registry rather than in that worker's environment: a separate record for our own agent, listed
ahead of pi's, the way claude_cowork is listed ahead of claude_code. What that record matches on cannot be
settled here, because the worker exports nothing to match on yet; Decision 13 says so and says what would
settle it.

Research (2026-10-26, read from the packages this workspace resolves, pi `0.84.2`, under
`node_modules/.pnpm/@earendil-works+pi-*@0.84.2/`, and from `pi.dev/docs/latest/extensions`):

- **pi declares a span tree, first-party.** `@earendil-works/pi-telemetry` exports a `TelemetryContext` /
  `TelemetrySpan` contract and a declarative schema system (`defineTelemetrySchema`, with
  `TelemetryParentDefinition` of `any` / `root_or_external` / `spans`).
  `@earendil-works/pi-agent-core`'s `AI_TELEMETRY_SCHEMA` and `HARNESS_TELEMETRY_SCHEMA` declare the whole
  tree (`dist/harness/telemetry.js` at 0.84.2): `pi.harness.run` (root or external parent, carrying
  `pi.session.id`, `pi.lane.name`, `pi.operation.{id,kind,recovery}`, ending on `pi.operation.outcome` of
  `completed|aborted|failed|suspended`), `pi.harness.turn` (parent `run`, carrying `pi.turn.id`),
  `pi.harness.tool` (parents `turn`/`run`, carrying `pi.tool.{name,call_id,replay,recovery}`, ending on
  `pi.tool.is_error`), `pi.harness.navigation`, `pi.harness.step`, `pi.harness.checkpoint`,
  `pi.harness.compaction`, `pi.harness.hook`, `pi.harness.sleep`, `pi.harness.event_handler`,
  `pi.session.write`, and `pi.ai.request` (carrying `pi.ai.{provider,model,api,operation,streaming}`,
  `pi.ai.response.{model,id,stop_reason}`,
  `pi.ai.usage.{input,output,cache_read,cache_write,reasoning,total}_tokens`, `pi.ai.usage.cost`,
  `pi.ai.stream.{chunk_count,time_to_first_chunk_ms}`, `pi.ai.error.type`).
  Two details the first draft of this record got wrong, both load-bearing below. `pi.harness.turn`
  declares `endAttributes: {}` (`dist/harness/telemetry.js:280`): it carries no outcome of its own, and the
  outcome in pi's schema is `pi.operation.outcome` on `pi.harness.run` (`:178`). And `pi.harness.navigation`
  (`:209`) is a real declared span, which the earlier inventory omitted; it is one of the four parents
  `pi.harness.step` declares (`:285-288`), where `pi.harness.turn` is the first.
- **The provider dialects are already flattened, upstream of us.** There is one `pi.ai.request` span with
  provider as an _attribute_, one closed cross-provider `stop_reason` enum
  (`stop|length|tool_use|error|aborted|deferred`), and one token taxonomy with cache and reasoning tokens
  first-class. pi's `@earendil-works/pi-ai` layer did the normalisation that we paid for three times over
  for Claude Code, Codex and Gemini. We consume one dialect, not one per model vendor.
  The schema's enum and the runtime type it comes from are not the same list: pi-ai's `StopReason`
  (`@earendil-works/pi-ai` `dist/types.d.ts:277`) is
  `pending|stop|length|toolUse|error|aborted|deferred`. The shim therefore maps `toolUse` to the schema's
  `tool_use` and emits nothing for `pending`, which is an in-flight marker rather than an outcome.
- **The contract has no backend in the CLI.** `pi-telemetry` ships `NOOP_TELEMETRY_CONTEXT` and
  `InMemoryTelemetryContext` and no exporter. Greps of the published packages at 0.84.2 find no
  `OTEL_*` variable, no `otlp` and no `@opentelemetry` reference at all, and no `telemetryContext` on the
  CLI's public surface; the only pi-owned telemetry variable is `PI_TELEMETRY`, the install-analytics
  opt-out (`dist/core/telemetry.js`, `dist/cli/args.js`). In-process embedders can pass a context to
  `startHarnessSpan`; a CLI user cannot.
- **No published pi line adds OTel export, as far as we checked.** The 2.x versions seen in the wild
  belong to a third-party plugin bundle. **UNVERIFIED:** the npm registry was not queried while writing
  this record, so the latest published version and its changelog are not established here. Everything
  below is pinned to 0.84.2, and the min-warned version in the Constants table is the one claim that a
  registry check has to settle before this record leaves Proposed.
- **The extension API is observe-only where we need it, and thinner than the first draft assumed.**
  Extensions are TypeScript files in `~/.pi/agent/extensions/`, default-exporting a function that
  receives the API and registers `pi.on(event, handler)`. The documented order is
  `input → before_agent_start → agent_start → (turn_start → message_* → tool_call → tool_execution_* → tool_result → turn_end)× → agent_end → agent_settled`.
  Read against the shipped types (`@earendil-works/pi-coding-agent`
  `dist/core/extensions/types.d.ts` at 0.84.2), three of the first draft's claims are false and they
  change what the shim can emit:
  - `turn_end` carries **no outcome**. `TurnEndEvent` (`:556`) is `{ type, turnIndex, message, toolResults }`.
  - `after_provider_response` carries **no usage**. `AfterProviderResponseEvent` (`:519`) is
    `{ type, status, headers }`.
  - `provider_stream_event` is **not in the event union** at all (`ExtensionEvent`, `:774`).

  What is readable is the assistant message itself. `AssistantMessage`
  (`@earendil-works/pi-ai` `dist/types.d.ts:297`) carries `api`, `provider`, `model`, `responseModel`,
  `responseId`, `stopReason` and a `Usage` (`:255`) of
  `input`, `output`, `cacheRead`, `cacheWrite`, `cacheWrite1h`, `reasoning`, `totalTokens` and a
  `cost` breakdown of `{ input, output, cacheRead, cacheWrite, total }`. That message reaches an
  extension on `message_end` and again on `turn_end`, and it is the single source for every
  `pi.ai.request` attribute the shim writes, including the reported cost. `getContextUsage()`
  (`ExtensionContext`, `dist/core/extensions/types.d.ts:244`) exposes context occupancy, and
  `sessionManager.getSessionId()` (`:219`, `ReadonlySessionManager` at
  `dist/core/session-manager.d.ts:140`, the method at `:207`) is how the shim learns pi's session id.

- **Community extensions export the wrong shape.** The two maintained OTel extensions emit metrics and
  **log records** (one in a Claude Code dialect with `claude_code.` swapped for `pi.`, one in GenAI
  convention logs); a third derives traces from hooks and invents its own parentage. None emits pi's
  declared harness tree, which is what a session trace in the explorer is made of.

Constraints at framing: no double trace; pi reuses the existing wrapper machinery, no parallel wrapper;
everything persisted is removable by `langwatch logout`; no third-party code is installed into a
developer's session by us (ADR-039 §7 and the claude/opencode plugin precedent, where we ship our own
plugins); customer trace routing is never configured through LangWatch's own `OTEL_*` namespace
(ADR-175 §1 governs LangWatch processes; wrapped children are a separate, existing injection path).

A note on scale, because reviews of this work have quoted the wrong half of it, and because the earlier
figure of "roughly 46 hand edits" could not be reconstructed from the text that asserted it. Here is a
count anyone can repeat. Take the files that name **both** `opencode` and `copilot` by hand: that is the
signature of a per-tool literal list, as opposed to a file that happens to mention one agent for a
quirk of its own. Excluding tests, there are **32** such files, and each is a candidate site for a `pi`
entry:

| Tree                            | Files | What they are                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sdks/typescript/src/cli`       | 17    | the wrapper surface: `program.ts`, `commands/wrap.ts`, `commands/ingestion/{hook,install}.ts`, `daemon/eligibility.ts`, `utils/commandCatalog.ts`, `utils/projectOption.ts`, and `utils/governance/{login-ceremony,otel-env-block,platform-tool-policy,session-context-agents,shell-rc,telemetry-targets,tool-env,wrapper,wrapper-mode,wrapper-path-choice}.ts`                            |
| `enterprise/modules/governance` | 8     | `contract/src/{ai-tool-catalog,platform-tool-policy}.ts`, `contract/src/features/cli/cli-bootstrap.ts`, `contract/src/features/ingestion/{ingestion-source-key.commands,otlp-receiver-policy}.ts`, `process/src/services/governance-mcp-tools.service.ts`, `browser/src/model/coding-agent/assistant-presets.ts`, `browser/src/features/ingestion-sources/toolCatalog/registered-tools.ts` |
| `modules/coding-agent`          | 5     | `contract/src/telemetry/{coding-agent-definition,index}.ts`, `contract/src/coding-agent-processing.ts`, `browser/src/model/{assistant-identity,assistant-presets}.ts`                                                                                                                                                                                                                      |
| `apps`                          | 2     | `apps/docs/src/features/shell/model/agent-wheel.ts`, `apps/docs/specs/published-urls.txt`                                                                                                                                                                                                                                                                                                  |

17 + 8 + 5 + 2 = 32. Treat that as the order of magnitude rather than the budget: not every site needs a
pi row (`shell-rc.ts` and `wrapper.ts` may fall out of the registry record), and the new files this record
adds (the definition, the shim, the specs) are not in it. The counter-figure is checkable too: the
registry record gives away nine derived constants for free, six sets in
`modules/coding-agent/contract/src/telemetry/index.ts:44-90`, `DECLARED_SPAN_NAMES`
(`coding-agent-span-admission.ts:16`) and the two alias maps
(`coding-agent-normalization.ts:195` and `:200`), plus six functions that walk
`CODING_AGENT_REGISTRY` and need no edit. The decisions below name every hand edit the registry record
does **not** give away.

## Decision

1. **Tool integration on the ingestion path only; no gateway path for pi.** `langwatch pi` registers
   alongside the other seven in `sdks/typescript/src/cli/program.ts` → `wrap.ts` → `runWrapped("pi")`.
   The subcommand list is one hand-written literal, `TOOL_WRAPPER_COMMANDS` (`program.ts:40-48`, today
   `claude`, `codex`, `copilot`, `code`, `cursor`, `gemini`, `opencode`), consumed once at `:787`. An
   earlier draft said "the other five" and left this constant out of its site list entirely; it is the
   first edit, and without it `langwatch pi` is not a command at all.
   `PLATFORM_TOOL_POLICY_DEFAULTS.pi` is `allowVk: false, allowOtelDirect: true`, so
   `resolveWrapperPath` finds a single allowed path and never prompts. Rejects a gateway path: every
   model's address is fixed in pi's own build, so there is no base-URL swap to make, and a half-wired
   `--tool-mode gateway` that cannot work is worse than an absent one.
   Two paired edits travel with that policy, and both are easy to miss because each schema is `.strict()`
   and the one mirror that is permissive fails in the wrong direction. The organisation's CLI bootstrap
   payload enumerates its tool keys by hand
   (`enterprise/modules/governance/contract/src/features/cli/cli-bootstrap.ts:6`), so a `pi` key is added
   there or the response rejects the very map the catalogue service builds by looping
   `PLATFORM_TOOL_SLUGS` (`enterprise/modules/governance/process/src/services/ai-tool-catalog.service.ts:305`).
   The SDK then carries its own copy of the policy table
   (`sdks/typescript/src/cli/utils/governance/platform-tool-policy.ts`), and its fallback for a slug it
   does not know is `{ allowVk: true, allowOtelDirect: true }` (`:28`), the opposite of what this decision
   chooses. pi therefore gets an explicit entry in `PLATFORM_TOOL_POLICIES` (`:33`) and in the
   hand-written `PlatformToolSlug` union (`:7`); relying on the default would silently offer pi a virtual
   key.

2. **The coding-agent id is `pi`; the ingestion sourceType slug is `pi_cli`.** `pi` joins
   `codingAgentSchema` and gets `telemetry/pi.ts` in the definition registry. The slug follows the
   `copilot_cli` precedent because a pi VS Code extension exists and would otherwise collide, and because
   `pi` as a bare governance slug reads as a unit, not a tool. The command stays `pi`; slug ≠ command is
   the established `claude` → `claude_code` shape. Rejects a bare `pi` slug: it would have to be widened
   the day a pi IDE extension ships, and widening a source-type slug after keys are minted against it
   means rewriting provenance on rows already stored.

   Four names therefore coexist, each belonging to a different reader, and two earlier passes of this
   record conflated them. The **wrapper command** is `langwatch pi`. The **ingestion slug** is `pi_cli`,
   and that is also the argument `langwatch ingest install` takes: `SUPPORTED_TOOLS`
   (`sdks/typescript/src/cli/commands/ingestion/install.ts:30`) is a list of source types, not of
   commands, which is why it reads `claude_code` and `copilot_cli` rather than `claude` and `copilot`, and
   `normaliseTool` (`:120`) only lowercases and maps `-` to `_` before demanding exact membership, so
   `langwatch ingest install pi` exits with "Unknown tool 'pi'". The **session-context hook argument** is
   plain `pi`, that field being the human-facing spelling (`session-context-agents.ts:33`, `claude-code`
   and `copilot` in the rows at `:81` and `:125`), so `langwatch ingest hook pi` is right. The **AI-tool
   catalogue slug** is plain `pi` as well, and that is what `ingestSourceType` returns in spite of its
   name (`coding-agent-pull-request-usage.service.ts:74`): its fallthrough passes the agent id straight
   through, and the value feeds the lookup `billing.isSourceNonBillable` is keyed on. The two plain-`pi`
   readers and the one `pi_cli` reader are not interchangeable: writing `pi_cli` into the billing lookup
   breaks it, and writing `pi` into `SUPPORTED_TOOLS` installs the seam under a source type no key is
   minted for.

3. **`matches()` tests pi's own record namespace and nothing else.** pi's definition is
   `matches: (signal) => signal.name.startsWith("pi.")`. The shared `signalSays` helper
   (`contract/src/telemetry/coding-agent-definition.ts:94-100`) is deliberately **not** used, and the
   reason is in its body: besides the namespaced-name test it also runs `signal.scope.includes(needle)`
   (`:97`) and `signal.service.includes(needle)` (`:98`). `pi` is a substring of `copilot` and of
   `anthropic`, so `signalSays(signal, "pi")` claims every Copilot span (scope `github.copilot.*`) and
   every record whose scope is `com.anthropic.claude_code.events`
   (`coding-agent-definition.ts:196-197`). Registry order would not save us: copilot is registered
   **last** (`telemetry/index.ts:21-28`), so a pi record placed anywhere ahead of it wins the Copilot
   spans. One correction to an earlier draft of this record: `openai` does **not** contain `pi`, so the
   substring hazard is two agents, not three.
   The namespaced-name test is exact where the substring test is not: `startsWith("pi.")` matches
   `pi.harness.run` and `pi.ai.request` and no `github.copilot.*` or `claude_code.*` name. It is also the
   only shape available, because the other two signal members are not ours to trust: `service.name` is
   what our own wrapper stamps (`OTEL_RESOURCE_ATTRIBUTES`, Constants), so testing it is a tautology, and
   the instrumentation scope our shim would set is not written down anywhere in the codebase yet.
   Rejects `signalSays(signal, "pi")`: it claims copilot's and Claude Code's spans, for the reason above.
   Rejects requiring the name namespace **and** a recognised instrumentation scope: no record in the
   registry requires two conditions to both hold. claude_code's is the only other two-part predicate and
   it is an OR that widens (`signalSays(signal, "claude_code") || signal.scope.includes("anthropic")`,
   `:201`), never an AND that narrows. The scope string such a condition would test does not exist today,
   so it would be written against a spelling that is still a guess (Decision 13 carries the full argument).
   This test says which product a span is **about** and nothing at all about who emitted it, which is what
   makes Decision 13 necessary.

4. **We ship our own extension, as a first-party shim, and install no third-party package.** The file goes
   into pi's extension directory and is registered in `telemetry-targets.ts` so `langwatch logout` removes
   it, exactly as `claude-plugin.ts` and `opencode-plugin.ts` are.
   **`langwatch pi` is not what writes it**, which an earlier draft had backwards, and the correction
   names two more hand edits. The seam is installed by `langwatch ingest install`
   (`sdks/typescript/src/cli/commands/ingestion/install.ts:198`, the function at `:203-233`), which
   resolves the row by key source type (`:225`) and then branches on a hard-coded id, `opencode` taking
   the plugin path and everything else the hook-entries path (`:227-230`). pi therefore needs `pi_cli` in
   `SUPPORTED_TOOLS` (`:30`, today `codex`, `claude_code`, `gemini`, `opencode`, `copilot_cli`) and an arm
   in that branch, or `langwatch ingest install pi_cli` installs no extension and silently writes hook entries
   into a file pi never reads. The wrapper path (`governance/wrapper.ts`) installs no session-context seam
   at all: it reports and offers a shell rc edit (`reportIngestionSetup` at `:541-576`) and refreshes only
   the Claude Code plugin (`reportPluginUpdate` at `:616-640`).
   Rejects adopting a community extension: it would export logs rather than
   pi's span tree (reopening the problem this record closes), and `langwatch pi` installing someone
   else's code in-process into a session holding live credentials is a supply-chain hop we would be
   imposing under our own brand. Pinning and auditing each release of a single-maintainer package is
   maintenance too, just maintenance we do not control.

5. **The shim emits pi's declared vocabulary, with its declared parentage.** Because the CLI exposes no
   `TelemetryContext` to extensions, the shim builds the spans itself with the OTel JS SDK, using pi's
   **names and attribute keys verbatim**: one `pi.harness.run` per `agent_start`/`agent_end`, a child
   `pi.harness.turn` per `turn_start`/`turn_end` carrying `pi.turn.id`, a `pi.harness.tool` per
   `tool_execution_start`/`_end` carrying `pi.tool.name` and `pi.tool.call_id` and ending on
   `pi.tool.is_error`, and a `pi.ai.request` per assistant message carrying the `pi.ai.*` attribute set.
   Rejects inventing a LangWatch-private event scope: speaking pi's own vocabulary is what makes the shim
   deletable and the receiver stable. We are the transport, never the author of the names.

   **The outcome goes on the run, not the turn.** An earlier draft told the shim to end `pi.harness.turn`
   "on the documented outcome". There is no such attribute: `pi.harness.turn` declares `endAttributes: {}`
   (`dist/harness/telemetry.js:280`), and the only outcome in pi's schema is `pi.operation.outcome` on
   `pi.harness.run`, a closed enum of `completed|aborted|failed|suspended` (`:178`). `TurnEndEvent` carries
   no outcome either (`dist/core/extensions/types.d.ts:556`), so there is nothing to read and nowhere
   declared to put it. The shim closes the turn with its timing and status only, and writes
   `pi.operation.outcome` once, on the run, from `agent_end`.

   **The required keys are what make the shim conformant, and seven of them have no source.** pi's schema
   marks attributes `required`, so a conformance test (Invariants) that only checks "every key we emit is
   declared" passes while the shim emits a span pi's own schema would reject. Below is the whole declared
   schema at 0.84.2, one row per span, listing exactly the keys that span's object marks `required: true`
   with the `dist/harness/telemetry.js` line each key was read from. The spans we do not emit are in the
   table so it can be checked against the file rather than trusted.

   | Span (declared at)                  | Keys pi marks `required: true`                                                                                                                                   | What the shim does                                                                                                                                                                                                                                                                                                                                                                                     |
   | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `pi.ai.request` (`:4`)              | `pi.ai.operation` (`:8`), `pi.ai.provider` (`:14`), `pi.ai.model` (`:19`), `pi.ai.api` (`:24`), `pi.ai.streaming` (`:29`)                                        | **emits.** provider, model and api read from `AssistantMessage` (`pi-ai` `dist/types.d.ts:300-302`). `pi.ai.operation` **invented**: no extension event carries it, so the shim writes the enum's `stream` (`:11`). `pi.ai.streaming` **invented**: `AssistantMessage` has no such field (`:297-317`), so the shim writes `true`, every pi API module being a streamer (`pi-ai` `dist/types.d.ts:189`) |
   | `pi.harness.run` (`:165`)           | `pi.session.id` (`:126`), `pi.lane.name` (`:132`), `pi.operation.id` (`:138`), `pi.operation.recovery` (`:144`), `pi.operation.kind` (`:170`)                    | **emits.** session id read from the API (below). `pi.operation.kind` is not a choice: the schema allows the single value `run` (`:173`). lane, operation id and recovery **invented**                                                                                                                                                                                                                  |
   | `pi.harness.turn` (`:257`)          | `pi.lane.name` (`:261`), `pi.operation.id` (`:267`), `pi.turn.id` (`:273`)                                                                                       | **emits.** `pi.turn.id` is `TurnStartEvent.turnIndex` (`dist/core/extensions/types.d.ts:550-554`) rendered as a string, the key's declared type being `string`. lane and operation id **invented**. The span does **not** require `pi.session.id`; the shim writes it anyway (Decision 8)                                                                                                              |
   | `pi.harness.tool` (`:329`)          | `pi.lane.name` (`:333`), `pi.operation.id` (`:339`), `pi.tool.name` (`:351`), `pi.tool.call_id` (`:356`), `pi.tool.replay` (`:362`), `pi.tool.recovery` (`:368`) | **emits.** name and call id from `ToolExecutionStartEvent` (`dist/core/extensions/types.d.ts:579-584`), and `pi.tool.is_error` on end from `ToolExecutionEndEvent.isError` (`:594-600`). lane, operation id, `pi.tool.replay` (**invented**, `never` of `never\|safe`, `:365`) and `pi.tool.recovery` (**invented**, `false`) have no source. `pi.turn.id` is `required: false` here (`:345`)          |
   | `pi.harness.step` (`:283`)          | `pi.lane.name` (`:290`), `pi.operation.id` (`:296`), `pi.step.kind` (`:302`), `pi.step.attempt` (`:308`)                                                         | not emitted                                                                                                                                                                                                                                                                                                                                                                                            |
   | `pi.harness.compaction` (`:187`)    | `pi.session.id`, `pi.lane.name`, `pi.operation.id`, `pi.operation.recovery` (the shared object, spread at `:191`), `pi.operation.kind` (`:192`)                  | not emitted                                                                                                                                                                                                                                                                                                                                                                                            |
   | `pi.harness.navigation` (`:209`)    | the same shared four (spread at `:213`), `pi.operation.kind` (`:214`)                                                                                            | not emitted                                                                                                                                                                                                                                                                                                                                                                                            |
   | `pi.harness.checkpoint` (`:231`)    | `pi.lane.name` (`:235`), `pi.operation.id` (`:241`), `pi.checkpoint.kind` (`:247`)                                                                               | not emitted                                                                                                                                                                                                                                                                                                                                                                                            |
   | `pi.harness.hook` (`:382`)          | `pi.lane.name` (`:386`), `pi.hook.name` (`:398`)                                                                                                                 | not emitted. `pi.operation.id` (`:392`) and `pi.hook.registration_id` (`:404`) are `required: false`                                                                                                                                                                                                                                                                                                   |
   | `pi.harness.sleep` (`:419`)         | `pi.operation.id` (`:423`), `pi.sleep.delay_ms` (`:429`)                                                                                                         | not emitted. Requires no lane name                                                                                                                                                                                                                                                                                                                                                                     |
   | `pi.harness.event_handler` (`:444`) | `pi.event.type` (`:448`)                                                                                                                                         | not emitted. `pi.lane.name` (`:455`) is `required: false`                                                                                                                                                                                                                                                                                                                                              |
   | `pi.session.write` (`:465`)         | `pi.lane.name` (`:469`), `pi.session.mutation` (`:481`)                                                                                                          | not emitted. `pi.operation.id` (`:475`) and `pi.session.item_type` (`:487`) are `required: false`                                                                                                                                                                                                                                                                                                      |

   Two readings of this schema in earlier passes of the record were wrong. `pi.session.id`,
   `pi.lane.name`, `pi.operation.id` and `pi.operation.recovery` are not "required on all harness spans":
   they are one shared object, `operationStartAttributes` (`:125-149`), spread into three spans only, so
   eight of the twelve declared spans never ask for `pi.operation.recovery` at all. And `pi.lane.name` and
   `pi.operation.id` are required much more widely than that object, each being re-declared per span.

   Where each key the shim writes comes from:
   - **verified:** `pi.session.id` from `ExtensionContext.sessionManager.getSessionId()`
     (`dist/core/extensions/types.d.ts:219`, `ReadonlySessionManager` at
     `dist/core/session-manager.d.ts:140`, the method at `:207`).
   - **verified:** every `pi.ai.*` provider, model, usage and cost value from `AssistantMessage`;
     `pi.turn.id` from `turnIndex`; the tool name, call id and error flag from the tool-execution events.
   - **invented, no source anywhere on pi 0.84.2's extension surface:** `pi.lane.name` (the string `lane`
     does not occur once in `dist/core/extensions/types.d.ts`), `pi.operation.id`,
     `pi.operation.recovery`, `pi.tool.replay`, `pi.tool.recovery`, `pi.ai.operation`, `pi.ai.streaming`.

   For each invented key the shim writes a schema-legal constant rather than omitting it: `"main"` for the
   lane, `false` for both recovery flags, `"never"` for the replay policy, `"stream"` and `true` for the
   two AI-request markers, and for `pi.operation.id` a value derived from the session id and the turn index
   so that it is at least stable within a run. Seven documented lies of convenience, and the single
   strongest argument for the shim's death date (Decision 12): an in-process `TelemetryContext` carries
   every one of them for real, because pi's harness is where they originate. The conformance test asserts
   the required set is _present_, not that it is faithful, and this table is what a reader compares it
   against.

   **Four declared spans are not emitted, and the reason is the event surface, not the parentage.** An
   earlier draft said the shim skips `pi.harness.navigation` and then `pi.harness.step` "has no declared
   parent available". That is wrong. `pi.harness.step` declares four legal parents and `pi.harness.turn` is
   the first of them (`:285-288`), a span the shim already opens, so parentage was never the obstacle. The
   obstacle is that pi 0.84.2's extension API fires no step, navigation, checkpoint or compaction event, so
   there is nothing to open or close those spans from. Rejects synthesising them from what the shim can
   infer: that would make us the author of pi's own structure, which this decision exists to prevent.

6. **Every model-call attribute is dual-written in GenAI semantic conventions, and the `pi.*` keys we rely
   on are allowlisted by hand.** The shim writes `gen_ai.operation.name`, `gen_ai.request.model`,
   `gen_ai.response.model`, `gen_ai.system` and `gen_ai.usage.{input,output}_tokens` beside the `pi.ai.*`
   keys on the same span.
   What the dual write buys is narrower than two earlier drafts said, and the narrowing is worth stating
   because the wrong reason would send someone to the wrong file. It does **not** buy the span's role.
   `genAiOperationRoleOf` compares a record's `genAiOperations` against `name.split(" ", 1)[0]`
   (`modules/coding-agent/contract/src/telemetry/gen-ai-operations.ts:38`), the first space-delimited word
   of the **span name**, not any `gen_ai.*` attribute. Copilot's names are `{operation} {target}` pairs, so
   its triple reads as GenAI operations (`chat`, `invoke_agent`, `execute_tool`,
   `coding-agent-definition.ts:233`); pi's names are single words with no space, so `split(" ", 1)[0]`
   returns the whole name and pi's `genAiOperations` must be its own span names verbatim:
   `{ session: "pi.harness.run", modelCall: "pi.ai.request", toolRun: "pi.harness.tool" }`. The role still
   comes from the registry record and still needs no hand-maintained list elsewhere, which is the property
   that matters, but it comes from the record's **names**, with or without the dual write.
   What the dual write actually buys is the fold. `CODING_AGENT_CONTRIBUTION_KEYS` already carries
   `gen_ai.request.model` (`coding-agent-normalization.ts:264`), `gen_ai.response.model` (`:269`) and
   `gen_ai.usage.{input,output}_tokens` (`:270-271`), so the model and the two headline token counts reach
   the fold on the day pi's definition lands, before anyone adds a single `pi.` key to that list. The
   `pi.*` keys then extend what the GenAI conventions have no name for.
   It does not make the server side branch-free, and an earlier draft of this record claimed that it did.
   Fact lifting copies an allowlist rather than the span: `liftSpanFacts` iterates
   `CODING_AGENT_CONTRIBUTION_KEYS` and silently drops every attribute that is not in it
   (`modules/coding-agent/process/src/rules/coding-agent-span-facts.rules.ts:82`, the list itself at
   `modules/coding-agent/contract/src/telemetry/coding-agent-normalization.ts:215-327`, 87 quoted
   literals, no spreads, and not one of them a `pi.` key). Every `pi.*` attribute this record depends on
   is added to that list or it never reaches the fold, and the failure is quiet: the span is stored, the
   session simply learns nothing from it. One edit covers both lanes, because the log canonicaliser reads
   the same list (`:403`).
   Two further corrections to the same claim. The noise filter's generic GenAI arm will never see a pi
   span at all: `shouldFilterCodingAgentSpan` returns false for any scope that is not a known noise scope
   before it reaches that arm (`contract/src/telemetry/coding-agent-span-filter.ts:95`, the scope set at
   `:36`), so there is nothing to change there and nothing should be asserted of it. And the `pi.*` keys
   stay for the reason they always did: they carry what the conventions have no name for, which is
   cache-write tokens, reasoning tokens, deferred operations, time to first chunk and pi's own reported
   cost. Rejects emitting the GenAI keys only and dropping the `pi.*` ones: it would lose every figure in
   that list, and it would make the shim's output impossible to check against pi's declared schema, which
   is the one guard against an upstream rename going unnoticed. Rejects the opposite too, `pi.*` only: the
   span's role would then have to be read from a hand-maintained list of pi's span names instead of from
   the registry record.

7. **Both cost figures are kept, and neither silently replaces the other.** pi reports `pi.ai.usage.cost`
   on a span, which is a combination the pipeline has not met: span-fed agents are priced from the
   catalogue, log-fed agents report their own cost. An earlier draft resolved that by letting the reported
   figure win, which contradicts the convention the repo already holds. Here the computed figure is the
   cost and the agent's own number is a drift signal kept beside it, because the two disagreeing is the
   alarm that either our price registry or the agent's pricing has gone stale
   (`specs/trace-processing/coding-agent-cost.feature:58` and `:61`; the split the drift subscriber reads
   at `modules/coding-agent/process/src/eventing/coding-agent-cost-drift.subscriber.ts:64` and `:81`). So
   `costUsd` stays catalogue-computed for pi and `agentReportedCostUsd` accumulates `pi.ai.usage.cost`,
   exactly as Claude Code's reported cost already behaves on the log lane.

   **The span lane cannot do this today, and it takes two edits, not one branch.** An earlier draft said
   the seam was "one branch and not a new projection", and that is wrong in a way worth being precise
   about, because each missing edit fails silently on its own.

   | Edit                                            | Where                                                                                                                    | Why it is needed                                                                                                                                                                                                                                                                                             |
   | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | accumulate the reported figure on the span lane | `coding-agent-session-span.projection.ts`, the declared-GenAI arm at `:299` and the `chargePricedCall` it calls (`:205`) | `chargePricedCall` writes **only** `costUsd` (`:220`). Nothing anywhere on the span lane touches `agentReportedCostUsd`; the one place it accumulates is the **log** projection (`coding-agent-session-log.projection.ts:254`). Without this edit the reported figure for a pi session is always zero        |
   | record the reported figure from a span event    | `coding-agent-cost-drift.subscriber.ts`, the span branch at `:49-69`                                                     | the subscriber splits by **lane**, not by what the fold holds: a span event calls `recordComputed` only (`:64`) and a log event calls `recordReported` only (`:81`). Even with the fold edit above, a pi session's reported cost reaches no drift metric, so the alarm this decision is built on never fires |

   The two together are what make the drift signal real for an agent that is span-fed _and_
   self-reporting, which pi is the first of. Rejects the cheaper alternative of routing pi's reported cost
   through the log lane so the existing accumulation picks it up: it would mean the shim emitting a log
   record that duplicates a span it already sent, which is the double-trace this record forbids
   (Invariants).

   The rest of the seam needs nothing. When the catalogue cannot price the model, the computed figure does
   not grow for that call and the reported figure still lands, which keeps the drift signal readable and
   never charges one call twice. The fold state already carries the two numbers and no third
   (`coding-agent-session-state.projection.ts:92-93`), and the read side already knows how to say
   "span-fed and unpriced": `isPricedAs`
   (`process/src/features/pull-requests/services/coding-agent-pull-request-usage.service.ts:286`) tests
   `SPAN_FED_MODEL_CALL_AGENT_IDS` against the catalogue, and returns a null cost rather than a zero
   (`:329`).

   Joining that set takes **one** declaration, not two, and an earlier draft had this backwards.
   `SPAN_FED_MODEL_CALL_AGENT_IDS` is derived from `modelCallsOnSpansOnly === true` and nothing else
   (`contract/src/telemetry/index.ts:89`), so the flag alone puts pi in the set that `isPricedAs` reads.
   What takes two declarations is the other predicate: `isSpanFedModelCall` requires the flag **and** a
   `modelCall` role resolved from `genAiOperations` (`contract/src/telemetry/gen-ai-operations.ts:46`),
   and that is the one deciding whether a span writes a per-call fact row. pi's record therefore declares
   its `genAiOperations` triple beside the flag, as copilot's does
   (`contract/src/telemetry/coding-agent-definition.ts:233`, with `modelCallsOnSpansOnly: true` at
   `:235`), but spelled with pi's own span names rather than GenAI operation names, for the reason
   Decision 6 gives; declaring only the flag would put pi in the set, satisfy the read side, and still
   write no per-call rows. Separately,
   `isModelCallSpan` (`contract/src/telemetry/coding-agent-span.ts:1`) is a hard-coded set of span names
   with no registry hook at all, and it is what the terminal banner
   (`modules/trace/browser/src/model/coding-agent/trace/terminal-session-banner.ts:91`) and the transcript
   (`contract/src/coding-agent-transcript-span.ts:40`) read, so `pi.ai.request` is added to
   `MODEL_CALL_SPAN_NAMES` by hand or pi's calls render as ordinary spans with correct costs behind them.
   pi declares no `nanoAiUnitAttributes`, because pi sells no unit of its own.

8. **The session key is pi's own session id, and carrying it on every span we emit is our one deliberate
   extension of pi's schema.** `deriveSessionKeyFromSpan` reads `pi.session.id`, which the shim writes on
   every span it emits, not only on the root. That is forced: the hook takes `{ name, attrs }` for one span
   and nothing else (`contract/src/telemetry/coding-agent-definition.ts:146-149`), so it cannot walk up to
   the run, and with `spansRequireSessionKey` true a turn or tool span without the key is dropped.
   An earlier draft justified this by saying pi's own schema makes the attribute required on every harness
   span. It does not. `pi.session.id` is declared in exactly one object, `operationStartAttributes`
   (`dist/harness/telemetry.js:126`), and that object is spread into three spans only: `pi.harness.run`
   (`:169`), `pi.harness.compaction` (`:191`) and `pi.harness.navigation` (`:213`). `pi.harness.turn`
   (`:257`) and `pi.harness.tool` (`:329`) do not declare it at all. So the shim writes one key pi declares
   on spans pi does not declare it on, and the conformance test (Invariants) is scoped accordingly: the
   emitted keys are a subset of what pi declares **somewhere in the schema**, with `pi.session.id` named as
   the single documented exception. Rejects writing it only where pi declares it: every turn and tool span
   would then be dropped for want of a session key, which deletes the session tree.
   `spansRequireSessionKey` is true, and `logsRequireSessionKey` is irrelevant with `logsOnly` false: pi
   itself emits no log records, though our extension causes one on pi's behalf (Decision 10). Rejects
   keying on the trace id as a fallback, which is what a false `spansRequireSessionKey` would do: a pi run
   is one trace per process, so the fallback would silently merge two concurrent sessions in the same
   terminal into one row.

   `sessionSpanNames` is doing more work than naming a root, and the work it does is admission. The
   admission gate derives `DECLARED_SPAN_NAMES` from that one field across the whole registry
   (`modules/coding-agent/contract/src/coding-agent-span-admission.ts:16`, which lives in the contract
   root and not under `telemetry/`), and `admitsCodingAgentSpan` (`:29`) lets a span through when it is
   self-namespaced (`:33`), when the registry gives it a GenAI role (`:35`), or when its name is declared
   and detection resolved an agent (`:36-37`, `return agent !== "unknown"`). There is no hand edit to make
   in that file, which an earlier draft asked for, because pi's declared names are reached through
   `sessionSpanNames` like every other agent's.
   What that gate does **not** do is separate the two uses of pi, and an earlier draft of this record said
   it did. Admission calls `detectCodingAgent({ recordName: name, scopeName })` with no `serviceName`
   (`:34`), and under Decision 3 pi matches on the record name alone, so every `pi.harness.run` is admitted
   whatever emitted it. Decision 13's guard sits in the registry's ORDER, and the record listed ahead of
   pi's would have to match on the scope name for the refusal to happen here at all; on a `service.name`
   marker it bites only later, at fact lifting (`process/src/rules/coding-agent-span-facts.rules.ts:26-32`),
   which re-attributes the span rather than keeping it out.

   **`SELF_NAMESPACED_SPAN_NAMES` stays Claude-only.** The five names in that set (`:8-14`) are all
   `claude_code.*`, and the `:33` check runs **before** detection, which is the whole point of it: those
   names bypass the registry. pi needs no entry there, because `sessionSpanNames` plus a name-only
   `matches()` already admits every span this record emits, so adding one would buy nothing and would make
   pi the second agent with a hard-coded name list outside its own record. Rejects extending the set for pi
   on symmetry grounds: the set exists for names that predate the registry record, not as the normal way in.

   The trap `sessionSpanNames` leaves is the gap in the role enum:
   `GenAiOperationRole` has three members only, `session`, `modelCall` and `toolRun`
   (`contract/src/telemetry/coding-agent-definition.ts:192`), and pi's tree has a level they do not cover.
   `pi.harness.turn` resolves to no role, so it is admitted only because `sessionSpanNames` lists it.
   `sessionSpanNames` is therefore `["pi.harness.run", "pi.harness.turn"]`, and every further harness span
   we choose to keep is listed there too or it is dropped at the dispatch filter
   (`process/src/eventing/coding-agent-processing.pipeline.ts:80`) with nothing recorded.

   We are deliberately giving up the other four harness spans pi declares, `pi.harness.compaction`,
   `pi.harness.step`, `pi.harness.checkpoint` and `pi.harness.navigation`. The list above omits them on
   purpose, and nothing is lost by the omission today because the shim cannot emit them either: pi 0.84.2's
   extension API fires no event for any of the four (Decision 5, Constants). Compaction is the one that
   will hurt first, since it is a canonical event kind we already fold for other agents
   (`coding-agent-definition.ts:34`). The day pi's extension API grows a compaction event, the change is
   two lines, the span and its name in `sessionSpanNames`, and this paragraph is the thing to revisit.

9. **Short runs are flushed before exit.** A non-interactive `pi -p` run can finish well inside a batch
   window, so the shim force-flushes the span processor on `agent_end` and again on `agent_settled`,
   under a bounded timeout, and never blocks pi's exit on a slow endpoint. Rejects relying on the
   default periodic flush, which is the whole "pi shows nothing" failure class for one-shot runs.

10. **Repository, branch and pull requests ride the existing paths, but pi has to declare itself on the
    log lane to reach them.** Git context arrives through the session context hook that copilot already
    uses (`specs/ai-governance/cli-wrappers/session-context-hook.feature`), and pull-request linkage
    follows from sessions plus that context (`specs/coding-agent/pull-request-linkage.feature`). What the
    earlier draft left out is that the linkage is driven from fold state rather than from spans:
    `shouldMapPullRequests` reads only the repository host, owner and name and the branch that the fold
    holds (`modules/coding-agent/process/src/eventing/pull-request-mapping.subscriber.ts:41`), and the
    only thing that fills those is a `langwatch.session_context` OTLP **log** record
    (`contract/src/telemetry/coding-agent-normalization.ts:334`, folded at
    `process/src/eventing/coding-agent-session-log.projection.ts:273`); the span lane only reads the memo
    that record leaves (`process/src/services/contribute-span-facts.service.ts:17`).

    **One answer, because only one of the two candidate mechanisms can work.** pi gets a row in
    `SESSION_CONTEXT_AGENTS` (`sdks/typescript/src/cli/utils/governance/session-context-agents.ts:79`,
    beside claude at `:80`, codex at `:96`, opencode at `:117` and copilot at `:124`) with
    `hookTarget: { kind: "plugin", resolve: () => piExtensionTarget() }`, and the **extension is the thing
    that runs the hook**: it shells out to `langwatch ingest hook pi` and the CLI builds and posts the
    record. That is not two mechanisms, it is the opencode shape exactly: opencode's row is
    `{ kind: "plugin", resolve: () => opencodePluginTarget() }` (`:122`), and the plugin file we write runs
    `langwatch ingest hook opencode` fire-and-forget (`governance/opencode-plugin.ts:22`, the spawn at
    `:153-159`) with a payload of `{ session_id, cwd, hook_event_name }` (`:144-148`). pi's extension can
    fill that payload from the API it already holds: `sessionManager.getSessionId()` and
    `sessionManager.getCwd()` (`dist/core/session-manager.d.ts:207` and `:204`, both in
    `ReadonlySessionManager` at `:140`).

    The row is not optional, and neither is its hook target. `hookTarget` is a required field on
    `SessionContextAgent` (`:50`), so "a row with no hook" does not type-check, and `kind: "plugin"`
    (`:28`) is the member that means precisely this: our own file, not entries merged into one of the
    user's. Without a row at all, `isSessionContextAgentId` (`:172-174`) rejects the slug and
    `sessionContextAgentFor` returns null (`:180-186`), so `langwatch ingest hook pi` has no agent to
    resolve and posts nothing.

    Rejects the alternative, the extension building its own `langwatch.session_context` log record and
    exporting it over the OTLP connection it already has: it would duplicate, in a file we want deletable,
    the git discovery, the spool, the fingerprint dedup and the key heal that the hook command owns, and it
    would mean the shim emitting log records after Decision 8 declares `logsOnly: false` and pi a span-only
    agent. The extension causes the record; it does not author it.

    The record's `session.id` (`session-context.ts:242`) has to be the same value the shim writes into
    `pi.session.id`, which is why both read `getSessionId()`. If the two ever differ, the context folds
    onto a session that does not exist, the repository fields stay empty, no pull request is ever linked,
    and nothing anywhere reports an error.
    The billing claim in the earlier draft was wrong on its own terms. `ingestSourceType`
    (`process/src/features/pull-requests/services/coding-agent-pull-request-usage.service.ts:74`) does not
    return the ingest-key source type at all; it returns the AI-tool-catalogue slug that
    `billing.isSourceNonBillable` is keyed on
    (`process/src/services/coding-agent-session-candidates.service.ts:110`), which is why `copilot` maps
    to `github_copilot` rather than to `copilot_cli`. Its fallthrough returns the agent id unchanged, so
    pi already resolves to `pi` and needs no arm. Writing a `pi_cli` arm there would break the very lookup
    it was meant to fix. Rejects having the shim emit the repository and branch as span attributes instead
    of reusing the context hook: the linkage subscriber reads fold state filled from the log record, so
    span attributes would arrive at a reader that never looks at them, and we would be maintaining two
    sources for one fact.

11. **Community extensions are accepted as compatibility, never as a dependency.** pi's definition
    carries `eventAliases` and `metricAliases` entries for the signal names the two maintained community
    extensions emit, so a customer already running one still lands in the trace explorer. Nothing is
    installed, nothing is audited, and the aliases are data in the definition, not a code path. Rejects
    ignoring those signal names: a customer who already runs one of those extensions would see their pi
    traffic land as untracked spans, and the first thing they would do is install ours alongside it, which
    is the double trace. Rejects normalising them in the canonicaliser instead, which would put
    third-party vocabulary into code rather than into one data field.

12. **The shim has a death date.** When pi wires its native `TelemetryContext` into the CLI, or ships
    `OTEL_*` support, `buildOtelEnvBlock("pi")` keeps its standard variables, `pi-plugin.ts` is deleted,
    and the definition, the canonicalisation, the projections and the billing arm do not change, because
    they were only ever reading pi's own declared names. Deleting the shim is also what fixes the seven
    required attributes it can only guess at, and retires the one key it writes where pi declares none
    (Decisions 5 and 8). Rejects keeping the shim as the supported path
    after that point, on the grounds that it is ours and therefore more predictable: two emitters of the
    same span names is the double trace the Invariants forbid, and the native one carries the lane and
    operation identity the shim invents.

13. **Our own registry record, not Langy, is where the two uses of pi are kept apart, and the mechanism is
    registry ORDER rather than a stricter pi predicate.** Detection is first-match-wins over a
    `CodingAgentSignal` of `{ name, scope, service }` and nothing else
    (`contract/src/telemetry/coding-agent-normalization.ts:17`, the signal at
    `contract/src/telemetry/coding-agent-definition.ts:80`), and Decision 3's predicate tests the name
    namespace, so pi's record claims every `pi.*` span that reaches the pipeline, including one emitted by
    our own in-house worker. A customer's session list would then grow rows for our product's internals.
    Today that cannot happen: that worker's environment carries no `OTEL_*` variable and a Go test keeps it
    that way (`services/langyagent/adapters/pi/spawn_test.go:403-407`, which fails on any key with an
    `OTEL_` prefix), so this is a guard against a later change rather than a fix for a live leak.

    The shape of the guard is the one the repo already uses for two products on one runtime. Claude Cowork
    and Claude Code share an event vocabulary and are told apart by a **separate record listed first**, not
    by making Claude Code's predicate stricter: the registry comment says so in as many words
    ("claude_cowork before claude_code because only service identity distinguishes them",
    `contract/src/telemetry/index.ts:19-20`, the array at `:21-28`), and cowork's own record matches on its
    distinguishing marker alone (`signalSays(signal, "cowork")`, `coding-agent-definition.ts:209`, with the
    ordering rationale at `:205-206`). So our worker gets its own record, listed **before** pi's, matching
    on whatever identifies it, and pi's predicate stays exactly as Decision 3 writes it.

    **UNVERIFIED: what that marker is.** Nothing in the worker sets one today. It exports no telemetry at
    all, so there is no scope name and no `service.name` to match, and this record changes nothing under
    `services/langy*` or `modules/langy`, so it cannot create one. The marker therefore has to be chosen by
    whoever wires an exporter there, and the natural choice is a distinct `service.name` set at that point.
    Two facts constrain that choice and both have to be read before the guard is written:
    - `service.name` is not available at **admission**. `admitsCodingAgentSpan` calls
      `detectCodingAgent({ recordName, scopeName })` with no `serviceName`
      (`contract/src/coding-agent-span-admission.ts:34`), and the signal's missing members read as empty
      strings, so a service-identity marker cannot refuse a span at the gate. The one call that passes all
      three members is fact lifting (`process/src/rules/coding-agent-span-facts.rules.ts:26-32`). A
      service-identity marker therefore re-attributes the span after it is admitted; it does not keep it
      out.
    - An instrumentation-scope marker **is** available at admission, since `scopeName` is passed there. If
      the guard has to bite at the gate rather than at attribution, the marker must be the scope name.

    What settles it: the commit that gives that worker an OTel exporter also decides the marker, and this
    record should be revisited then rather than guessing the spelling now. `specs/coding-agent/pi-sessions.feature`
    therefore carries no scenario for this guard and says so in its header: a scenario naming a marker
    nobody has chosen could not be written, let alone bound. This paragraph is where the hazard lives
    until then.

    Rejects making pi's own predicate stricter (name namespace **and** a recognised scope): it would be the
    only two-part condition in the registry, it would test a scope string that does not exist yet, and it
    would put the discriminator in the wrong record, so the day our worker changes its scope the customer's
    pi sessions break rather than our own rows leaking. Rejects discriminating on the ingestion source
    type, which is the natural answer and is not available here: the source type arrives later as the
    `langwatch.source` resource attribute (`contract/src/telemetry/gen-ai-operations.ts:17`), read well
    after `matches()` has run.

## Constants

| Name                                          | Value                                                                                        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tool command                                  | `pi`                                                                                         | `langwatch pi` wrapper subcommand; child binary name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Coding-agent id                               | `pi`                                                                                         | `codingAgentSchema`; the id of the definition in a new `modules/coding-agent/contract/src/telemetry/pi.ts`, beside the seven that exist                                                                                                                                                                                                                                                                                                                                                                                                                            |
| sourceType slug                               | `pi_cli`                                                                                     | ingest-key provenance; `SOURCE_TYPE_BY_TOOL.pi`; added to `CODING_AGENT_SOURCES` (`enterprise/modules/governance/contract/src/features/ingestion/otlp-receiver-policy.ts:15`, module-private rather than exported, so the edit is inside that file and its only reader is `:37`) or the origin reads `ai_tool`, not `coding_agent`                                                                                                                                                                                                                                 |
| Catalogue slug for billing                    | `pi`                                                                                         | what `ingestSourceType("pi")` already returns by fallthrough, and the key `isSourceNonBillable` takes (Decision 10)                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Assistant kind                                | `pi`                                                                                         | `KnownAssistantKind`, `ASSISTANT_PRESETS`, icon and tile; `assistant-presets.ts` exists as three byte-identical copies (`enterprise/modules/governance/browser/src/model/coding-agent/`, `modules/coding-agent/browser/src/model/`, `modules/user/browser/src/model/coding-agent/`, all md5 `c14cafe9b5305844ec95f0dafd53596d` at framing), so each tile edit is made three times                                                                                                                                                                                  |
| Platform tool slug                            | `pi`                                                                                         | `PLATFORM_TOOL_SLUGS`; policy defaults below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `OTEL_RESOURCE_ATTRIBUTES`                    | `service.name=pi`                                                                            | analytics grouping only; never the match test (Decision 3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `OTEL_EXPORTER_OTLP_PROTOCOL`                 | `http/protobuf`                                                                              | the receiver's own default branch (`packages/otlp/src/body.ts:336` decodes protobuf unless the content type is `application/json`), and what every wrapper but gemini already pins (`otel-env-block.ts:64`, `:76`, `:103`, `:118`, `:132`; gemini alone is `http/json` at `:94`). An earlier draft chose `http/json` and justified it as "matches the receiver default, as for copilot", which is wrong twice: copilot pins `http/protobuf` with a comment that grpc falls back silently (`:110-113`), and JSON is the receiver's fallback branch, not its default |
| `OTEL_TRACES_EXPORTER`                        | `otlp`                                                                                       | spans are pi's only signal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `OTEL_LOGS_EXPORTER`, `OTEL_METRICS_EXPORTER` | `none`                                                                                       | pi emits neither; an unset value would start idle exporters                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Session root span                             | `pi.harness.run`                                                                             | `sessionSpanNames`; carries `pi.session.id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Declared span names                           | `pi.harness.run`, `pi.harness.turn`                                                          | `sessionSpanNames` is also the admission list; an unlisted harness span with no GenAI role is dropped (Decision 8)                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Session key attribute                         | `pi.session.id`                                                                              | `deriveSessionKeyFromSpan`, and the `session.id` the context record must repeat (Decision 10). Written on every span the shim emits, including the two pi does not declare it on, which is the schema's single documented exception (Decision 8)                                                                                                                                                                                                                                                                                                                   |
| Model call span                               | `pi.ai.request`                                                                              | span-fed model calls, dual-written to `gen_ai.*`; also added to `MODEL_CALL_SPAN_NAMES` by hand (Decision 7)                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Reported cost attribute                       | `pi.ai.usage.cost`                                                                           | folded into `agentReportedCostUsd` as a drift signal, never as the session's cost (Decision 7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Extension file                                | `pi-plugin.ts` in pi's extension directory                                                   | first-party shim, written by `langwatch ingest install pi_cli` and not by `langwatch pi` (Decision 4); registered in `telemetry-targets.ts`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Session context seam                          | a row in `SESSION_CONTEXT_AGENTS` with `hookTarget: { kind: "plugin" }`                      | the extension shells out to `langwatch ingest hook pi`, the opencode shape; `hookTarget` is a required field, so there is no row without one (Decision 10)                                                                                                                                                                                                                                                                                                                                                                                                         |
| Platform policy defaults                      | `allowVk: false, allowOtelDirect: true`                                                      | ingestion only (Decision 1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Declared but not emitted                      | `pi.harness.navigation`, `pi.harness.step`, `pi.harness.checkpoint`, `pi.harness.compaction` | all four are declared (`dist/harness/telemetry.js:209`, `:283`, `:231`, `:187`) and pi 0.84.2's extension API fires no event for any of them. Not a parentage problem: `pi.harness.step` names `pi.harness.turn` first among its four legal parents (`:285-288`) (Decision 5)                                                                                                                                                                                                                                                                                      |
| Verified against                              | pi `0.84.2`                                                                                  | the version this workspace resolves (`node_modules/.pnpm/@earendil-works+pi-*@0.84.2/`), read at framing. Every schema, type and attribute claim in this record is pinned to it                                                                                                                                                                                                                                                                                                                                                                                    |
| Min. warned version                           | **UNVERIFIED**                                                                               | the npm registry was not queried while writing this record, so neither the latest published version nor the first line carrying these extension events is established. Settle this before the record leaves Proposed; until then the shim refuses to install against anything below the version it was read from                                                                                                                                                                                                                                                   |

## Invariants

| Invariant                                            | Meaning                                                                                         | Satisfied by / test anchor                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No double trace                                      | A pi run never produces both our shim's spans and a second capture of the same calls            | no gateway path exists for pi (Decision 1); the shim is idempotent on install and a second install does not double-register handlers                                                                                                                                                                                                                                                                                                                                                                                                                 |
| We never author pi's names                           | Every span name and attribute key we emit is one pi declares                                    | a conformance test asserts two directions against the resolved `AI_TELEMETRY_SCHEMA` and `HARNESS_TELEMETRY_SCHEMA`: the shim's emitted keys are a subset of what pi declares **somewhere in the schema**, and every key pi marks `required: true` on a span we emit is present on that span (the set Decision 5 tabulates). The test names one exception by hand, `pi.session.id` on `pi.harness.turn` and `pi.harness.tool`, and fails on any second one. An upstream rename or a newly required key fails the build rather than silently drifting |
| No agent claims another's spans                      | `matches()` admits a record named `pi.*` and nothing else                                       | unit test: a `copilot` signal (scope `github.copilot.*`) and a Claude Code signal (scope `com.anthropic.claude_code.events`) are not matched as pi, which a `signalSays(signal, "pi")` test would fail on both, `pi` being a substring of `copilot` and of `anthropic` (Decision 3)                                                                                                                                                                                                                                                                  |
| Logout symmetry                                      | Every persisted artifact is discoverable and removable                                          | `pi-plugin.ts` registered in `scanTelemetryTargets()`; env vars via `telemetryEnvVarNames("pi")`; extend `specs/ai-governance/cli-wrappers/logout.feature`                                                                                                                                                                                                                                                                                                                                                                                           |
| Ingestion is wired, not fallthrough                  | `SOURCE_TYPE_BY_TOOL.pi` exists                                                                 | unit test: pi resolves to ingestion and mints a `pi_cli` key, and never returns a gateway shape                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Billing resolves to a real source                    | `ingestSourceType("pi")` returns `pi`, the catalogue slug `isSourceNonBillable` is keyed on     | unit test on the pull-request usage service: a pi session's billable lookup resolves through the fallthrough, and a span-fed call the catalogue cannot price reports as unpriced rather than as zero                                                                                                                                                                                                                                                                                                                                                 |
| The two cost figures stay separate                   | catalogue pricing lands on `costUsd`, `pi.ai.usage.cost` on `agentReportedCostUsd`              | two tests, one per missing edit in Decision 7. On the session span projection: a pi call the catalogue cannot price grows the reported figure and leaves the computed one alone, which fails today because `chargePricedCall` writes only `costUsd` (`coding-agent-session-span.projection.ts:220`). On the cost-drift subscriber: a pi session records both a computed and a reported figure, which fails today because the span branch calls only `recordComputed` (`coding-agent-cost-drift.subscriber.ts:64`)                                    |
| Every attribute we rely on survives canonicalisation | each `pi.*` key the fold reads is in `CODING_AGENT_CONTRIBUTION_KEYS`                           | unit test on fact lifting: a `pi.ai.request` span yields the usage, cost and model facts, which fails loudly today because the allowlist holds no `pi.` key (Decision 6)                                                                                                                                                                                                                                                                                                                                                                             |
| Session context folds onto the pi session            | the `langwatch.session_context` record's `session.id` equals the `pi.session.id` the shim emits | both read `sessionManager.getSessionId()`. Unit test: a pi session's repository and branch are set from the record the extension's `langwatch ingest hook pi` call posts, so pull-request linkage fires (Decision 10)                                                                                                                                                                                                                                                                                                                                |
| Nothing identifies pi by substring                   | no reader decides "this is pi" by testing whether a name contains `pi`                          | `pi` sits inside `copilot` and `anthropic`: the ordered fragment lists at `modules/trace/browser/src/model/terminal-origin.ts:17` and `modules/trace/browser/src/model/coding-agent/trace/terminal-session-banner.ts:31` gain no `pi` entry, and the terminal view marks a pi trace from `origin === "coding_agent"` instead (`terminal-origin.ts:41`)                                                                                                                                                                                               |
| Our own pi worker is never a customer session        | a `pi.*` span our in-house worker emits is not folded as a customer's coding-agent session      | registry order, not a stricter pi predicate: a record for our own agent is listed before pi's and claims the signal first, as claude_cowork does before claude_code (`telemetry/index.ts:19-28`). The test is a registry-order test, the same shape as cowork's. **UNVERIFIED** until that worker exports anything to match on, which is also when the test can be written (Decision 13); zero edits under `services/langy*` either way                                                                                                              |
| A one-shot run is not lost                           | `pi -p` exports before the process ends                                                         | test anchor: a run whose spans close inside one flush window still exports, and a dead endpoint does not delay exit past the bounded timeout                                                                                                                                                                                                                                                                                                                                                                                                         |
| The shim is deletable                                | Removing the extension changes no server code                                                   | the definition, canonicaliser and projections read only pi's declared names; no test references `pi-plugin.ts` from the server side                                                                                                                                                                                                                                                                                                                                                                                                                  |

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

## Consequences

**Positive.** pi becomes the first agent tracked without us authoring a single fact about it: the span
tree, the attribute keys and the cost figure are all pi's own, so an upstream rename fails a conformance
test rather than degrading data quietly. The dual write means the generic GenAI canonicaliser and the
generic fold carry pi with no pi-shaped branch in either, and the day pi wires its own `TelemetryContext`
the shim is deleted and nothing server-side changes. pi is also the first agent to exercise the
span-fed-and-self-reporting combination, which makes the cost drift signal real on the span lane for every
agent that follows.

**Negative.** We take on seven invented attribute values (Decision 5) because pi marks keys required that
its extension API gives no source for, so the conformance test can prove the required set is present and
cannot prove it is true. Four spans pi declares are given up, compaction among them, so a canonical event
we fold for other agents is missing for pi until pi fires the event. Three hand-maintained lists grow
(`SUPPORTED_TOOLS`, `CODING_AGENT_CONTRIBUTION_KEYS`, `MODEL_CALL_SPAN_NAMES`) and each one fails silently
when it is missed: the span is stored and the session simply learns nothing from it. Two edits are needed
before the reported cost figure is anything but zero, and either one alone leaves no error behind.

**Obligations this creates.** Whoever gives our in-house worker an OTel exporter also chooses its
telemetry marker and writes the registry-order guard; until then our own `pi.*` spans would fold as
customer sessions if that worker ever exported anything, which no code prevents today. Whoever takes this
record out of Proposed first settles the minimum pi version against the npm registry and the worker marker
above, both marked UNVERIFIED here. And whoever deletes the shim owns the death-date check: the extension
exists only while pi's CLI has no exporter, and nothing expires it on its own.

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
  `specs/api-keys/unified-api-keys.feature`, `specs/trace-processing/coding-agent-cost.feature`,
  `modules/coding-agent/specs/session-git-context.feature`
- `@earendil-works/pi-telemetry` (span contract and schema system),
  `@earendil-works/pi-agent-core` `dist/harness/telemetry.d.ts` (the declared tree)
- `pi.dev/docs/latest/extensions` (extension API and event order)
