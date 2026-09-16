# ADR-132 implementation ladder

Companion to `132-pi-as-tracked-coding-agent.md`. That document decides *what* and
*why*; this one fixes *in what order*, and is the tracking list for the work.

One rung is one commit. A rung names the files it touches, the scenarios it binds
by exact title, and the command that proves it. A rung leaves the tree green — if
it needs the next rung to compile, it was cut wrong.

All rungs land in pull request #8139 on branch `worktree-shiny-zooming-kahn`.
No second branch, no second pull request.

Scenarios come from `specs/coding-agent/pi-session-capture.feature` (33, all
tagged `@unimplemented` today).

## Binding mechanics — read before rung 1

A scenario is bound by a JSDoc annotation above the test:

```ts
/** @scenario "A session started fresh has no parent" */
```

A `// @scenario "…"` line comment binds equally well, and several bound tests
here use that form. **This document claimed the JSDoc form was required until
rung 21 disproved it** by breaking a line-comment tag and watching parity drop
from 25/25 to 24/25 naming the scenario, then restoring it. The rule is recorded
with its correction attached rather than quietly rewritten: a false binding rule
is worse than no rule, because the next reader "fixes" working bindings to obey
it and the suite stays green while enforcing less.

Two ways this silently fails to bind, both of which report green:

1. The title must be in **double** quotes. Five titles here contain an
   apostrophe, so single quotes are a tempting and wrong reflex.
2. The scenario must have had `@unimplemented` **removed**. Left on, the checker
   skips the scenario, the test binds to nothing, and the suite passes while
   enforcing nothing.

The feature file is currently listed in `LEGACY_INERT` in
`platform/app/scripts/check-feature-parity.ts`. That entry is deleted by rung 1 —
the first rung that binds a scenario — not later.

Three of the 33 are Scenario Outlines (feature file lines 98, 131, 205). One
annotation binds an outline whole, whatever its example count.

## Blockers this ladder found that ADR-132 does not name

Three things refuse or misbehave before capture can work. None appear in the ADR;
one appears in issue #8128 but filed as a list to extend rather than a thing that
throws. All three are verified in the code, not inferred.

| What | Where | How it fails |
|---|---|---|
| Personal ingestion key mint | `platform/app/ee/governance/services/ingestionKey.service.ts:214-215` | `isWrappedTool("pi")` is false, so the mint throws `IngestionKeySourceNotAllowedError`. Removing the two 501 refusals gets past the command-line tool and straight into a server refusal. |
| Command-registration drift test | `sdks/typescript/src/cli/__tests__/feature-map-drift.unit.test.ts` | Parses `program.ts` and hard-fails the moment `pi` is registered without a matching `PLUMBING_COMMANDS` entry. The app-side twin (`capabilityCatalog.coverage.unit.test.ts`) is on the record in #8128; this one is not. |
| Direct-telemetry policy lookup | `platform/app/ee/governance/services/platformToolPolicy.service.ts:88` used at `platform/app/src/server/routes/auth-cli.ts:2582-2603` | No `pi` key means the resolved slug is undefined and the whole `allowOtelDirect` check is skipped. An organisation that switched pi's direct path off still mints the key. This refuses **silently, in the permissive direction**, and it is server-side, so the command-line tool's own policy entry does not cover it. |

The third is folded into rung 2 rather than given a rung of its own: it is one
line beside an entry that rung already edits, and leaving it out lets rung 19's
scenario pass while the enforcement point behind it stands open.

Ruled out after checking: the mint route takes `source_type` as a free-form
string (`auth-cli.ts:2379`), so nothing rejects the literal `pi` on the wire; and
`coding-agent-source-type.ts:27` passes an unknown agent through unchanged, so pi
needs no entry there. ADR-132 is right on both.

## The ladder

### 1. Accept `pi` in both launch modes — remove the two 501 refusals

- **Files** — `sdks/typescript/src/cli/utils/governance/tool-env.ts` (new `case "pi"`), `.../otel-env-block.ts` (`pi: "pi"` in `SOURCE_TYPE_BY_TOOL`), `.../__tests__/wrapper-mode.unit.test.ts`, `specs/coding-agent/pi-session-capture.feature` (drop `@unimplemented` on the bound scenario), `platform/app/scripts/check-feature-parity.ts` (delete the `LEGACY_INERT` entry and its comment)
- **Scenarios** — "pi is accepted as a tool that can be launched"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/wrapper-mode.unit.test.ts`, then `pnpm --filter @langwatch/web check:feature-parity`
- **Depends on** — nothing

### 2. Give pi a governable policy entry in both copies of the tool list

- **Files** — `sdks/typescript/src/cli/utils/governance/platform-tool-policy.ts` (`PlatformToolSlug`, `PLATFORM_TOOL_POLICIES`), `platform/app/ee/governance/services/platformToolPolicy.service.ts` (`PLATFORM_TOOL_SLUGS`, `PLATFORM_TOOL_POLICY_DEFAULTS`, **and `PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE` at `:88`**), new drift test under `platform/app/ee/governance/services/__tests__/`
- **Scenarios** — "The two copies of the governed tool list name the same tools"
- **Proves it** — `pnpm test:unit platform/app/ee/governance/services/__tests__/platformToolPolicy.drift.unit.test.ts`
- **Depends on** — 1

Order inside this commit matters. The two lists are byte-identical today, so a
drift test written now passes and proves nothing. Add pi to the command-line copy
first, run the test and watch it go red, then add the server copy. Precedent for
reading across the package boundary: `capabilityCatalog.coverage.unit.test.ts`
does the same file-read traversal.

### 3. Let the server mint a personal ingestion key for pi

- **Files** — `platform/app/ee/governance/services/ingestionKey.service.ts` (`PERSONAL_INGEST_SOURCE_TYPES`)
- **Scenarios** — none, enabling work
- **Proves it** — `pnpm test:unit platform/app/ee/governance/services/__tests__/ingestionKey*.unit.test.ts`
- **Depends on** — 1

### 4. Add the pi agent definition, appended last, with a bounded match rule

- **Files** — `.../coding-agent-processing/agents/_types.ts` (`CodingAgent` union), `.../agents/pi.ts` (new, `logsOnly: true`), `.../agents/index.ts` (last entry, plus the do-not-reorder comment), `.../agents/__tests__/pi.unit.test.ts` (new)
- **Scenarios** — "pi's match rule does not fire on a scope or service that merely contains its letters", "An existing agent's session is not relabelled as pi"
- **Proves it** — `pnpm test:unit platform/app/src/server/event-sourcing/pipelines/coding-agent-processing/agents/__tests__/pi.unit.test.ts`
- **Depends on** — nothing

Carries the registry-position check from the ADR Gates table as a separate,
unbound test case: the reorder has to fail on its own.

### 5. Register the hidden `langwatch pi` subcommand

- **Files** — `sdks/typescript/src/cli/commands/wrap.ts` (`wrapPi`), `.../program.ts` (`.command("pi", { hidden: true })`, mirroring `:580`), `.../utils/commandCatalog.ts` (`PLUMBING_COMMANDS`), `.../daemon/eligibility.ts` (`DENIED_COMMANDS`), `platform/app/src/features/langy/__tests__/capabilityCatalog.coverage.unit.test.ts` (`EXCLUDED_COMMANDS`), new hidden-command test
- **Scenarios** — "The pi command runs but is not advertised yet"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/__tests__/`, then `pnpm test:unit platform/app/src/features/langy/__tests__/capabilityCatalog.coverage.unit.test.ts`
- **Depends on** — 1

Five files in one commit by necessity: two source-scanning tests parse
`program.ts` and fail the instant pi appears without its exclusion entries.

### 6. Rename the agent-neutral parts of the codex rollout path off `codex`

- **Files** — `sdks/typescript/src/cli/utils/governance/codex-rollout-otlp.ts`: lift the neutral discovery, tail, transport and refusal handling (`walkRolloutFiles:139`, `drainCodexSpool:225`, `postCodexTurns:384`, `ingestRefusal:359`, the batcher at `:576`) into a shared module; update `wrapper.ts` and the six codex test suites' imports
- **Scenarios** — none, enabling work
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/codex-` and `pnpm typecheck:all`
- **Depends on** — nothing

Pure rename, no behavior change. Doing this *after* the pi reader exists is
exactly how the duplicated reader the ADR warns about gets shipped.

### 7. Resolve pi's session directory three ways, in precedence order

- **Files** — `sdks/typescript/src/cli/utils/governance/pi-session-dir.ts` (new) and its test
- **Scenarios** — "A session kept somewhere other than the default place is still found"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-dir.unit.test.ts`
- **Depends on** — nothing

`--session-dir` from the passed-through arguments, then
`PI_CODING_AGENT_SESSION_DIR`, then `sessionDir` in settings, then
`~/.pi/agent/sessions`.

### 8. Read the session header, and treat a missing file as normal

- **Files** — `sdks/typescript/src/cli/utils/governance/pi-session-file.ts` (new) and its test
- **Scenarios** — "A session abandoned before pi wrote anything records nothing and reports no error"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-file.unit.test.ts`
- **Depends on** — 7

### 9. Build turn events from pi's rows, in order, named pi

- **Files** — `sdks/typescript/src/cli/utils/governance/pi-session-otlp.ts` (new) and its test
- **Scenarios** — "A captured pi session shows the whole conversation in order", "The record names pi even though another provider answered", "Capture sends events and no spans"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-otlp.unit.test.ts`
- **Depends on** — 8, 4

Depends on rung 4 because the event names emitted here must be the ones
`agents/pi.ts` maps onto canonical kinds. Choosing them independently is how the
two halves silently disagree.

### 10. Map cost onto the events, and leave unreported measurements blank

- **Files** — `pi-session-otlp.ts` and its test
- **Scenarios** — "The session cost counts assistant turns, work inside tools, and summarised stretches", "A turn pi charged nothing for is recorded as zero", "A turn carrying no cost at all is left blank rather than counted as zero", "Measurements pi never reports are left blank rather than shown as zero"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-otlp.unit.test.ts`
- **Depends on** — 9

### 11. Tail the file across passes: pick up appends, survive a shrink, keep what a crash left

- **Files** — `pi-session-otlp.ts` (harvest loop — re-check size on each pass rather than trusting a remembered offset), `pi-session-stream.unit.test.ts` (new)
- **Scenarios** — "Turns appended after a read are picked up by the next one", "A session that stopped without shutting down cleanly keeps the turns pi had written"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-stream.unit.test.ts`
- **Depends on** — 10

### 12. Key de-duplication on the pair (session identifier, row identifier)

- **Files** — `pi-session-otlp.ts`, `pi-session-stream.unit.test.ts`
- **Scenarios** — "The same turn is not recorded twice", "Two sessions sharing row identifiers are kept apart"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-stream.unit.test.ts`
- **Depends on** — 11

The header line carries no row identifier and is excluded from the set rather
than keyed on its session identifier.

### 13. Resolve lineage: parent path to parent identifier, or blank

- **Files** — `pi-session-otlp.ts` (stamp `parent_session_id` and `is_fork`), `pi-session-lineage.unit.test.ts` (new)
- **Scenarios** — "A session started fresh has no parent", "A session split off another records where it came from", "The parent is recorded as an identifier, and the parent's file location is not stored", "A parent whose file has been deleted leaves the parent blank"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-lineage.unit.test.ts`
- **Depends on** — 8, 12

No server change is needed. The fold at
`coding-agent-session.derivation.ts:562-563` already reads both attributes; it
has simply never seen an agent that fills them.

### 14. Resuming a session records one session, not three

- **Files** — `pi-session-lineage.unit.test.ts`, plus whatever rung 13 leaves to fix in `pi-session-otlp.ts`
- **Scenarios** — "Resuming a session does not create a second one"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-session-lineage.unit.test.ts`
- **Depends on** — 13

### 15. Wire the reader into the wrapper, gated on whether an endpoint exists

- **Files** — `sdks/typescript/src/cli/utils/governance/wrapper.ts` (a pi streamer block mirroring `:741-770`: start-time stamp, unreferenced poll timer, skip while a pass is in flight, final sweep guarded), `.../__tests__/wrapper.unit.test.ts`
- **Scenarios** — "A session already captured on the server is not also captured from the file", "A session with no virtual key is captured from the file", "A pi session LangWatch did not launch is left alone"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/wrapper.unit.test.ts`
- **Depends on** — 14, 6

**Revised at v10 — this paragraph said the reverse.** It read: "the streamer
must be absent when the run is not in the no-virtual-key mode", and the heading
above said the rung was gated on that mode. Both were written when we believed
pi honors an OpenAI-compatible base-URL swap, so that a key-holder would be
captured server-side instead. pi honors neither `OPENAI_BASE_URL` nor
`ANTHROPIC_BASE_URL`, and we do not take the route that would work (see the ADR's
first Invariant, and revision v12 for the price of that route), so there is no
server-side capture to fall back to: gating on the mode would have switched
capture off for exactly the customers who pay, silently. The no-double-trace rule
still holds — it is just no longer reachable through pi, because we capture pi
one way only.

What replaces it is physical rather than policy: the streamer runs when an
endpoint and an ingestion token exist to post with, and does not when they do
not (gateway returns omit both, `wrapper-mode.ts:340-347`). Do **not** branch on
`modeResult.mode` here. When capture cannot run, say so on stderr rather than
skipping in silence — a capture that is off and quiet is indistinguishable from
one that is on and working.

The start-time stamp is unchanged and is the third scenario.

That stamp needs stating precisely, because a loose reading of it loses data.
The existing filter compares the file's **modification** time, not its creation
time — `findRecentRollouts` keeps a file when `s.mtimeMs >= sinceMs`
(`codex-rollout-otlp.ts:320`). So a session resumed with `--resume` is *in*
window: pi reopens the old file and appends, the modification time moves, and
the file is picked up. Only a file untouched during this run is skipped.

The real consequence is the opposite of exclusion. A resumed file enters the
window carrying its entire prior history, not just the new rows, so the same
turns are offered again on every resume. Nothing is lost; the thing that stops
them being sent twice is the de-duplication key from rung 12. That is why rung
12 comes before this one, and why its two scenarios are the ones that hold here.
No extra scenario is needed: "The same turn is not recorded twice" covers the
re-offer, and "Resuming a session does not create a second one" covers identity.

### 16. Capture never disturbs the coding session

- **Files** — `pi-wrapper-noninterference.integration.test.ts` (new; sibling of `wrapper-shell-reapply.integration.test.ts`)
- **Scenarios** — "Capture that cannot reach LangWatch does not disturb the coding session", "The command exits when pi exits"
- **Proves it** — `pnpm --filter langwatch test src/cli/utils/governance/__tests__/pi-wrapper-noninterference.integration.test.ts --run`
- **Depends on** — 15

### 17. Capture writes nothing and modifies nothing

- **Files** — `pi-readonly.unit.test.ts` (new)
- **Scenarios** — "Launching pi through LangWatch leaves the user's machine unchanged", "Capture leaves pi's session file exactly as pi wrote it"
- **Proves it** — `pnpm --filter langwatch test:unit src/cli/utils/governance/__tests__/pi-readonly.unit.test.ts`
- **Depends on** — 15

### 18. Put pi on all four settings-tile lists

- **Files** — `platform/app/src/components/me/tiles/assistantIcons.ts` (`ASSISTANT_KINDS:11`, `ASSISTANT_PRESETS:36`), `platform/app/ee/governance/services/aiToolEntry.service.ts` (`SUPPORTED_ASSISTANT_KINDS:69`, `ASSISTANT_KIND_TO_TOOL_SLUG:92`), a pi icon asset, a tile test
- **Scenarios** — "The tool tile offers pi", "A pi policy chosen in the tile is accepted when saved"
- **Proves it** — `pnpm test:unit platform/app/ee/governance/services/__tests__/aiToolEntry*.unit.test.ts`
- **Depends on** — 2

All four in one commit deliberately. `ASSISTANT_KIND_TO_TOOL_SLUG` fails
silently: `resolveToolPolicyOverrides:484-514` skips a kind it cannot map and
falls back to the permissive defaults, which is the half-registration failure the
ADR cites against itself. The compiler carries the first two steps and abandons
the last two.

### 19. A pi policy set in the tile is the one the launcher applies

- **Files** — `platform/app/src/server/api/routers/__tests__/user.cliBootstrap.integration.test.ts` (extend)
- **Scenarios** — "A pi policy set in the tile is the one the launcher applies"
- **Proves it** — `pnpm test:integration platform/app/src/server/api/routers/__tests__/user.cliBootstrap.integration.test.ts --watch=false`
- **Depends on** — 18

### 20. Register pi across the remaining product surfaces

- **Files** — `.../terminalView/sessionBanner.ts` (`BannerAgent:17`), `.../terminalView/TerminalView.tsx` (`AGENT_BANNERS:965`), `platform/app/src/features/traces-v2/utils/terminalOrigin.ts` (`CODING_AGENT_SERVICE_MARKERS:19`), `platform/app/src/components/me/agentIdentity.ts` (`ASSISTANT_KIND_BY_AGENT:13`), `platform/app/ee/governance/services/ingestKeyProvenance.utils.ts`, `.../platformIngestionTemplates.seeds.ts:71`
- **Scenarios** — none, enabling work
- **Proves it** — `pnpm typecheck:all` and `pnpm test:unit platform/app/src/features/traces-v2`
- **Depends on** — 4, 18

The Gates table calls this the weakest rung: human review against the list in
issue #8128, because the compiler says nothing. The one compiler link in the set
is `sessionBanner.ts` to `AGENT_BANNERS`, and only because that is an exhaustive
record type.

### 21. Register pi across the remaining command-line surfaces

- **Files** — `sdks/typescript/src/cli/commands/ingestion/install.ts` (`SUPPORTED_TOOLS:47`), `.../ingestion/context-session.ts` (`AGENTS:36` and the help text at `:69`), `sdks/typescript/src/cli/program.ts:487` and `:922`
- **Scenarios** — none, enabling work
- **Proves it** — `pnpm --filter langwatch test:unit` and `pnpm typecheck:all`
- **Depends on** — 5

## Scenario coverage

All 33 assigned, none orphaned: rung 1 ×1, 2 ×1, 4 ×2, 5 ×1, 7 ×1, 8 ×1, 9 ×3,
10 ×4, 11 ×2, 12 ×2, 13 ×4, 14 ×1, 15 ×3, 16 ×2, 17 ×2, 18 ×2, 19 ×1.

## Where this is riskiest

- **Rungs 9 and 10 against rung 4.** The turn-content builder is new work and the
  ADR never fixes the event names. Cost reaches the session only when the agent
  is logs-only and the event lands as the canonical request event carrying a cost
  field (`coding-agent-session.derivation.ts:984-1005`). If pi's three
  cost-bearing row kinds do not all map onto that one canonical event, the cost
  total is provable in a command-line test and wrong in the product. This is the
  rung most likely to show the ADR under-specified something.
- **Rung 2's drift test.** Nothing in this repository crosses the app-to-package
  boundary except by reading a file by path. Written loosely it becomes a guard
  that cannot fail — the exact failure it was added to prevent.
- **Rung 17.** Proving absence across the whole wrapper path, when
  `buildShellReapply` genuinely does write a shell function for other tools. A
  weak version of this test passes without checking anything.

## Open questions

- Whether a pi icon asset exists or may be used. `ASSISTANT_PRESETS` requires an
  icon location; rung 18 assumes a new asset and has checked neither the
  directory nor the licensing.
- Which test lane rungs 16 and 19 belong to. The package has its own test
  configuration and sits outside the app's two-lane split.
- Whether pi needs its own branch in `buildOtelEnvBlock`. The fallback returns
  endpoint and headers only, which is right for a tool that emits no telemetry of
  its own, but nothing confirms it. Rung 1's test is the first thing that will
  say.
- ~~Whether the ADR's count of nineteen registration sites reconciles.~~
  Resolved, and the ladder was wrong. Issue #8128's sixteen already include
  `SUPPORTED_ASSISTANT_KINDS`, which is also one of the four tile lists, so the
  union adds three symbols and not four: **nineteen distinct sites**, matching
  the ADR. Counting basis, stated so the next reader does not redo it: the
  sixteen from #8128, plus `ASSISTANT_KINDS`, `ASSISTANT_PRESETS` and
  `ASSISTANT_KIND_TO_TOOL_SLUG`.
