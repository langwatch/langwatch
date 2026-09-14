# ADR-132: pi as a tracked coding agent

**Date:** 2026-09-14

**Status:** Accepted

**Owner:** Sergio Esteban

## Context

pi (`@earendil-works/pi-coding-agent`) is a coding agent LangWatch does not
track. It emits no OpenTelemetry: its `packages/telemetry` is type contracts
with no exporter, and the only network call it makes on its own behalf is an
anonymous install ping.

pi writes every session to disk as JSONL, under
`~/.pi/agent/sessions/<slugged-cwd>/<timestamp>_<uuid>.jsonl`. A real session
file was read to confirm the contents rather than trusting the format doc: a
header carrying a UUID session id, a `version` field and the working directory;
then one row per event. Rows are of several kinds — `message`, `model_change`,
`thinking_level_change`, and the format also defines `compaction`,
`branch_summary`, `label`, `session_info` and two custom kinds — and only
assistant rows carry model, provider, stop reason and cost; user and tool-result
rows carry none of them. Assistant rows carry `usage` with tokens split four ways and
`cost.total`; and a `parentId` on every row but the header and the root message,
forming the fork tree. Counted, not estimated: 132 rows, 130 with a `parentId`,
43 assistant turns, every one of them carrying a `cost.total`, summing to
$3.4405 — of which 5 were exactly zero (see §9).

The format is documented (`docs/session-format.md`), carries an explicit
`version`, is on its third revision, and auto-migrates older files on load.

pi also offers an extension API — TypeScript files loaded per run or from a
settings array, with events covering messages, turns, tools and sessions. An
earlier draft of this ADR built the whole capture path on it. That draft was
red-teamed and did not survive; §Rejected alternatives records why, because the
reasoning is not obvious from the outside and will otherwise be re-proposed.

Two things force the decision now. LangWatch uses pi internally: `langy`, our
own assistant, embeds it (`services/langyworker` depends on `pi-ai` and
`pi-coding-agent`), and `services/langyagent/adapters/pi/` drives it. And pi is
a front end for several model providers, so a customer on pi is a customer whose
whole agent surface is invisible to us. There is no external customer demand on
record.

pi differs from every agent we track in one way that shapes the decision: it is
a host. A user running pi may be talking to any provider behind it. What we
track is the agent the person used, not the provider it dialled.

## Decision

**1. We launch pi through the existing wrapper, as `langwatch pi`, hidden.**

`sdks/typescript/src/cli/commands/wrap.ts` exposes one thin shim per tool, each
calling `runWrapped(tool, args)`. pi joins that list. No parallel launcher,
matching the constraint ADR-039 placed on Copilot.

The subcommand registers with `{ hidden: true }`, as every other wrap
subcommand does (`program.ts:415`, `:432`, `:449`, `:466`, `:546`, `:563`,
`:580`). A published CLI subcommand cannot be withdrawn — npm versions do not
unpublish — so shipping it unlisted is what keeps the internal-first decision
reversible.

**2. We read pi's session file while pi runs. We do not load an extension.**

This is the mechanism codex already uses, in the same function.
`wrapper.ts:741-770` creates a streamer, polls on an interval whose timer is
`unref`'d so it can never hold the event loop open, skips a tick if the previous
harvest is still in flight, and runs one final sweep after the child exits
inside a `try`/`catch` commented "never block exit on it". pi gets the same
block against its own sessions directory.

Everything we need is in the file, so nothing is gained by being inside pi's
process, and four things are lost by it — see §Rejected alternatives.

Because the reader is a separate process, this satisfies the "write nothing to
the user's machine" constraint without qualification.

Scope: we capture only sessions we launched. A plain `pi` typed into a shell is
out of scope and tracked as #8132. An earlier draft claimed here that a plain
`pi` inside a wrapped shell would also be captured, which contradicted that
follow-up; the claim is withdrawn.

A user can relocate the sessions directory three ways, and pi resolves them in
this order (`settings.md:243`): `--session-dir <dir>`, then the
`PI_CODING_AGENT_SESSION_DIR` environment variable
(`environment-variables.md:82`), then `sessionDir` in `settings.json`
(`settings.md:237`). We resolve all three in that order. The flag is parsed from
`toolArgs`, not guessed. An earlier draft specified the flag only; the other two
would have silently captured nothing.

**Two properties of pi's file that bound what capture may assume.** Both were
measured against the shipped `SessionManager`, not read from docs.

*The first write is deferred.* `_persist` buffers every entry in memory and
creates the file only when the first assistant message arrives, with
`openSync(path, "wx")` (`dist/core/session-manager.js:738-766`, comment at
`:1168-1177`). Executed: the file does not exist after the session is created,
after a user message, or after a `model_change` — it appears on the first
assistant reply. So a session abandoned before the first reply leaves no file,
and there is nothing to capture. Capture must treat that as normal, not as an
error. An earlier draft claimed pi writes every turn as it goes; it does not.

*A current-version file only grows.* Every write after the first flush is
`appendFileSync` (`:745`, `:766`). Measured across three real runs against one
session: same inode, sizes 1400 → 2274 → 3150, each earlier state a byte-exact
prefix of the next. Resuming appends; it does not rewrite. The one exception is
a session written by an older pi at file version 1 or 2: opening it triggers
`_loadEntries` → `_rewriteFile` (`:676-678`, `:710`), which truncates and
rewrites in place — measured at 874 → 869 bytes, same inode. This fires once, on
load, before any new turn, and never for a file already at the current version
(`migrateToCurrentVersion` returns early at `:75-85`). A reader must therefore
re-check the file's size on each pass rather than trusting a remembered offset,
and re-read from the start when it has shrunk.

**3. We emit events only. No spans.**

pi's file records a sequence of messages, not a tree, and supplies no trace or
span ids. Emitting spans would mean minting ids pi never gave us and defining
parentage we would be inventing. `claude_cowork` already runs events-only end
to end (`claudeCowork.ts:20`, `logsOnly: true`), so the path is proven. Spans
are a follow-up.

**4. Our records say `pi`, never the provider behind it.**

`langy` sets the precedent: `services/langyagent/adapters/otelrelay/genai.go`
scopes to `langy-agent` (L317) and sets `service.name=langy` (L375) even though
every span it forwards describes a call to some other provider. It names the
agent.

**5. pi's registry matcher must not test for the bare string `pi`.**

`signalSays` (`_types.ts:101-107`) is substring-based, and `pi` is a substring
of both `anthropic` and `copilot`. A naive matcher placed before `claudeCowork`,
`claudeCode` or `copilot` in the first-match-wins registry (`index.ts:22-29`)
would relabel every Claude Code, Cowork and Copilot record as pi. This was
confirmed by execution, not by reading: scope `com.anthropic.claude_code.events`
and service `copilot-cli` both match a bare `pi` test.

The matcher therefore tests the bounded forms we ourselves emit — the
`pi.` name prefix and the exact service name `pi` — and `piAgent` is appended
last in `CODING_AGENT_REGISTRY`. Both the matcher shape and the registry
position are load-bearing; a reviewer moving the entry earlier reintroduces the
bug silently, so the registry entry carries a comment saying so.

The reverse direction is also guarded: no `anthropic` in any scope or service
name we emit.

**6. The stored agent id is `pi`. No database migration; nineteen code sites.**

ADR-039 established that the stored slug need not match the command
(`claude` → `claude_code`, `copilot` → `copilot_cli`), chosen where the command
name would be ambiguous. pi has no such ambiguity. Command and slug match.

No ClickHouse migration is needed. `Agent` is `LowCardinality(String)`
(`00051_create_coding_agent_sessions.sql:69`), not an enum;
`coding-agent-session.clickhouse.repository.ts:217` writes
`String(record.Agent ?? "")`; `coding-agent-source-type.ts:28` passes unknown
agents through unchanged; and `agents/index.ts:52-59` states the stored field is
`z.string().min(1)` precisely because it "may name an agent this build's union
no longer has (or does not yet have)".

The earlier draft stopped there and called this "no schema change". That was
wrong. Sixteen code sites register an agent, and the red team put five of them
in a "fails the build" bucket. That was also wrong, and it was measured: `pi`
was added to the `CodingAgent` union and `pnpm typecheck:all` was run against a
clean baseline. **Zero new errors.**

The reason matters more than the number. None of the nineteen lists derive from
`CodingAgent`. Each is a hand-copied literal: `sessionBanner.ts:17-24` declares
its own `BannerAgent` with the same six members, and
`platform-tool-policy.ts:23-30` declares `PlatformToolSlug` while
`platformToolPolicy.service.ts:27-34` re-declares it with a file comment asking a
human to keep the two matching. Adding a member to one union never reaches
another file. It breaks the exhaustive `Record` in the same file you just
edited, and nothing else.

So the compiler confirms you finished a file. It never tells you a file exists.
There is no safety net for this class of change, and the cost of that is already
on record: `ee/governance/services/aiToolEntry.service.ts:71-78` carries a
comment describing this exact bug shipping once for `claude_cowork` — the
drawer's picker offered it, the `z.enum` gating the Prisma write rejected it,
and every save failed.

Implementation therefore works from the enumerated list in the issue, not from
compiler output. Collapsing the nineteen lists onto one source of truth is a
follow-up, and the right long-term fix.

A later rename is cheaper than feared: the sessions table is a
`ReplacingMergeTree(UpdatedAt)` and `Agent` is not in its sort key, so a rename
is a re-insert with a bumped `UpdatedAt`, not a mutation.

**7. pi must also be registered in the wrapper's own tool tables.**

`langwatch pi` throws today, in both modes, before any of the above matters.
`tool-env.ts` has no `pi` case, so gateway mode exits 501 `gateway_unsupported`;
`SOURCE_TYPE_BY_TOOL` (`otel-env-block.ts:11-25`) has no `pi`, so ingestion mode
exits 501 `otel_direct_unsupported`. `pi` is also absent from
`PlatformToolSlug` and `PLATFORM_TOOL_POLICIES` (`platform-tool-policy.ts:23-30`,
`:49`), so it currently resolves to the both-permitted defaults at `:44-47`
rather than to an entry an org admin can govern. The server twin
(`platformToolPolicy.service.ts:27-34`) needs the same entry; its file comment
asks a human to keep the two in sync and nothing enforces it.

The settings tile that an org uses to govern a tool runs on a further chain of
four lists, of which only the first was previously in scope:

| List | Location | Role |
| --- | --- | --- |
| `SUPPORTED_ASSISTANT_KINDS` | `aiToolEntry.service.ts:69-82` | the `z.enum` gating the write |
| `ASSISTANT_KINDS` | `assistantIcons.ts:11-20` | the list the picker offers |
| `ASSISTANT_PRESETS` | `assistantIcons.ts:36` | exhaustive record; needs a label and an icon |
| `ASSISTANT_KIND_TO_TOOL_SLUG` | `aiToolEntry.service.ts:92-104` | maps the saved choice to a tool slug |

The last is load-bearing and fails quietly: `resolveToolPolicyOverrides`
(`:484-514`) skips a kind it cannot map and falls back to
`PLATFORM_TOOL_POLICY_DEFAULTS`, so a policy an admin saved for pi would be
ignored with no error. Registering pi in the write gate but not the other three
produces exactly the half-registered agent this ADR cites `claude_cowork` as a
warning about. All seven surfaces belong to the pi implementation itself, not to
a follow-up — they are rungs 18 and 20 of `132-implementation-ladder.md`. This
pull request carries the decision only; no registration code ships in it.

**8. One pi session is one LangWatch session. Lineage comes from the file.**

| Field | Source |
| --- | --- |
| `sessionId` | the `id` in the session file header |
| `parentSessionId` | the `id` in the parent file's header, read by opening it |
| `isFork` | the header carries a `parentSession` at all |

pi is the first agent to populate `parentSessionId` and `isFork`
(`coding-agent-session.types.ts:90`), which the model has carried unused.

**Row identifiers are unique within a file, not across files.** `generateId`
retries only against the in-file index (`session-manager.js:21-29`), and
`createBranchedSession` copies the parent's row identifiers into the child
verbatim (`:1173`) — measured: a parent and its child share all four row ids
`cecadf21, a2703ef1, 6e455960, 2b868d0c` under different session ids. Any
de-duplication must therefore key on the pair (session id, row id). Keying on
the row id alone would drop a branch's inherited history as if it were a repeat,
silently. The header line is not an entry and carries no row id of its own; it
must be excluded from the de-duplication set rather than keyed on its session
id.

pi writes a header `parentSession` only when a session was split off another
one — `/fork`, `/clone`, or `newSession({ parentSession })`
(`session-format.md:197`). Its value is a **file path**, not a session id.
Capture resolves it by opening that file and reading the `id` out of its first
line, using the same header reader the capture already needs for the session's
own id. That is the whole mechanism.

Three consequences follow, and each is deliberate:

- **A path is not an id.** Storing the path would never have joined to any
  stored `SessionId`, and would have written the user's home directory into
  ClickHouse. The field is once-set at `derivation.ts:562`, so a wrong value
  would have been permanent. Resolving to the id avoids all three.
- **A deleted parent yields no parent.** If the parent file is gone we store
  `parentSessionId` as null and still set `isFork`. The field is already
  nullable; a missing ancestor is an ordinary outcome, not a failure.
- **We do not distinguish pi's several ways of splitting.** A fork, a clone and
  a programmatic child all write the same header field. `isFork` answers "did
  this come from another session", which is the only question the model asks.

**Resume creates no lineage, because resume creates no session.** `--resume`
and `--continue` reopen the existing file and keep appending to it
(`session-format.md:3`, "in-place branching without creating new files"). There
is one session id, one record, and no parent. An earlier draft asserted that a
resumed session records its predecessor as a parent; that was wrong, and the
scenario asserting it has been deleted rather than fixed.

**9. Where a number has no source, we show nothing — not zero.**

pi reports cost and tokens. It does not report lines changed, commits, or pull
requests. Those stay empty rather than showing a confident zero.

This has a known limit worth stating: some assistant turns in real pi sessions
record `cost.total` of exactly `0`. That is pi's own gap, not ours, and it
renders identically to a genuinely cheap turn. See §Known gaps.

The distinction cuts one level deeper, and the reader must honour it. A turn
whose `cost` object is **missing entirely** — because pi did not write one, or
because a future pi renames the field — is absent, and is recorded as absent. It
is not zero. Only an explicit `cost.total` of `0` is recorded as zero. Collapsing
the two would make a capture failure indistinguishable from a cheap session,
which is the exact reading error this decision exists to prevent. Both halves
have their own scenario, bound at rung 10 of the ladder.

## Invariants

- **One capture path per run.** The no-double-trace rule (`wrapper-mode.ts:18-21`)
  holds by the same guard codex uses: the reader runs only when
  `modeResult.mode === "ingestion"` (`wrapper.ts:743`). With a virtual key the
  gateway captures server-side and the reader does not run. This matters more
  for pi than for codex, because pi honours a base-URL swap — `langy` proves it
  (`spawn.go:23`, `OPENAI_BASE_URL`) — so gateway mode will genuinely capture
  once §7 lands.
- **No writes to the user's machine.** No settings file, no extensions folder,
  no rc-file function, no `--profile`-style flag.
- **No `anthropic` in scope or `service.name`.** See §4.
- **We never modify pi's session files.** Read-only, append-tolerant, tolerant
  of a file growing between reads.
- **A failed capture never fails the session.** Inherited from the codex block's
  `catch`, and load-bearing rather than incidental.

## Gates

What guards the code. Implementation and review both read this table. `none`
means none, and is deliberate — a human gate on a reversible small-radius path
is where review turns into theatre.

| Path | Reversible? | Blast radius | Required gate |
| --- | --- | --- | --- |
| Publishing a `langwatch pi` subcommand | **No** — npm versions do not unpublish | Large: public CLI surface | Ships `{ hidden: true }`, matching `program.ts:415`–`:580`. A test asserts the command is registered and not listed in help output. |
| Posting captured turns to the ingestion endpoint | **No** — the transcript is the user's source code, and it leaves the machine | Large | Runs only when `modeResult.mode === "ingestion"` (`wrapper.ts:743`). A test asserts the streamer is `null` when a virtual key is present. |
| pi's entry in `CODING_AGENT_REGISTRY` | Yes | Large: a bare-`pi` matcher relabels every Claude Code, Cowork and Copilot record | A test asserts the matcher rejects scope `com.anthropic.claude_code.events` and service `copilot-cli`, and that `piAgent` is last in the registry. Both are load-bearing; test them separately so a reorder fails on its own. |
| The nineteen registration sites | Yes | Large: a missed site ships a half-registered agent that fails at save time, as `claude_cowork` did | Human review against the enumerated list in #8128. The compiler catches none of them — measured, see §6. This is the weakest gate in the table and the reason #8134 exists. |
| Governance policy entry, both copies | Yes | Medium: a missing entry silently resolves to the both-permitted defaults at `platform-tool-policy.ts:44-47` instead of something an admin can govern | A test asserting `PLATFORM_TOOL_POLICIES` and the server's `PLATFORM_TOOL_SLUGS` hold the same slugs. Nothing enforces this today for any tool. |
| Stored agent slug `pi` | Yes: `ReplacingMergeTree(UpdatedAt)`, `Agent` not in the sort key | Small: a rename is a re-insert | none |
| Reading pi's session files | Yes: read-only | Small | none — covered by the invariant, not by a gate |

## Known gaps

Recorded because they are real and unaddressed, not because they block.

**Nothing detects this breaking.** No workflow in `.github/workflows/` runs any
coding-agent binary; `capture-coding-agent-matrix.ts:11-19` screenshots seeded
trace ids and asserts nothing about capture. `assertCodexTurnHarvest`
(`shell-rc.ts:561`) checks that config was written, never that a record arrived.
Time to detection for a silent pi capture failure is unbounded. pi inherits a
monitoring floor of zero from the agents already shipped; this ADR does not
raise it, and the gap belongs to all of them.

**Cost fails to the worse mode.** A missing or renamed cost field reads as
`0`, which renders as a real $0.00 rather than as absent. Combined with pi's own
zero-cost turns, a genuine capture failure is not visually distinguishable from
a cheap session.

Both point at the same follow-up: an ingest-side check that a captured assistant
turn carries non-null cost, and an alert when a tracked agent's capture rate
drops. That is one issue covering every agent, not a pi feature.

## Rejected alternatives

**A pi extension posting telemetry as events happen.** This was the previous
draft in full. It fails four ways, each verified against pi's shipped `dist/`
rather than its docs:

1. *It can hang pi at exit, indefinitely.* `runner.js:623-651` awaits every
   handler serially with no timeout and no `Promise.race`;
   `agent-session-runtime.js:296-303` awaits that during `dispose()`, and
   `interactive-mode.js:3220-3255` awaits `dispose()` before `process.exit(0)`,
   after the TUI is already torn down. A slow POST freezes pi on a dead screen,
   and `isShuttingDown` swallows a second SIGTERM.
2. *It can crash pi.* There is no `unhandledRejection` listener anywhere in
   pi's `dist/`, so a floating rejection from a fire-and-forget `fetch` routes
   into the registered `uncaughtException` handler (`:3325-3327`) and exits 1.
   LangWatch being unreachable would kill the user's coding session.
3. *It loses sessions anyway.* Three exit paths skip `session_shutdown`
   entirely: `emergencyTerminalExit()` (`:3258-3265`, commented "Do not run
   normal shutdown", fires on a dropped SSH connection or a closed tab),
   `uncaughtCrash()` (`:3276-3296`), and SIGKILL. Quitting mid-turn also drops
   the turn's cost, because `dispose()` does not await `session.abort()`.
4. *Ordering is not guaranteed.* `emitUIPromptEvent` dispatches through
   `queueMicrotask` unawaited (`runner.js:309-313`).

Reading the file has none of these properties, because it is not in pi's
process. A crash loses only what pi had not yet written — which, per §2, is
everything up to the first assistant reply, and after that nothing.

Two further points settle it. pi's own docs call `-e` suitable "only for quick
tests" (`extensions.md:8`) and forbid timers or sockets in the extension factory
(`:222`) — exactly what a batching exporter needs. And the file format carries a
version field, three revisions and auto-migration, while the event API carries
no version at all; the draft asserted the opposite stability ordering.

**Building pi's emitter from scratch.** The previous draft argued pi should not
share code with codex, on the reasoning that an abstraction drawn from two
callers takes the shape of the first, and that extraction should wait for a
third. The premise was wrong: roughly 85% of the codex path is already
agent-neutral. `buildSessionContextLogPayload` (`session-context.ts:252`)
already takes `agent: string`. `postCodexTurns` is body-agnostic transport —
bearer token, 5s abort, refusal-status mapping. The discovery and tailing code
maps onto pi's directory layout, which is also slugged-cwd folders with
timestamped files. pi reuses this path; the shared parts are renamed off
`codex`, not reimplemented.

One correction to that reuse figure. The 85% covers discovery, tailing and
transport. It does not cover the builder that turns turns into events: the only
log builder in the CLI is `buildSessionContextLogPayload`, which emits a single
session-context record, not turn content. The turn-content event builder is
net-new code, not a rename. `claudeCowork.ts:20 logsOnly: true` is a server-side
fold flag and is not a precedent for a CLI emitter.

**Merging a resumed session into its parent.** Rejected: pi keeps them apart,
and a merge that degrades to a split when the pointer breaks produces two
shapes with no way to tell them apart afterwards.

## Consequences

Positive: pi users get transcript, cost and session boundaries with one command.
pi becomes the first agent to
populate session lineage. Our own use of pi becomes visible to us. The capture
path cannot crash or stall the user's editor session, which is not true of the
alternative and is now true of pi before it is true of some agents we already
ship.

Negative: we depend on pi's session file format. It is versioned and migrating,
which is better than the event API, but it is still not a contract written for
us. We now own a second file-tailing capture path in the CLI, and the shared
parts must actually be shared rather than copied — a copy here is the failure
mode, not the abstraction.

Neutral: nineteen registration sites is the real cost of adding any agent, and
this is the first ADR to write the number down — and the first to establish, by
measurement, that the compiler flags none of them. The list is a checklist, and
until #8134 lands it is the only safety net there is.

Out of scope, each with a filed follow-up:

| Follow-up | Issue |
| --- | --- |
| Repository changes (commits, pull requests, lines) | #8129 |
| Spans | #8130 |
| Governance enforcement | #8131 |
| Tracking plain `pi` runs (permanent extension, or a sessions sweep) | #8132 |
| Capture-health monitoring — not pi-specific | #8133 |
| One source of truth for the agent list — not pi-specific | #8134 |
| Public onboarding entry and docs page | #8135 |
| Any change to langy | none — explicitly untouched |

## Implementation entry point

Start here, in this order. The first step is not the interesting one — it is the
one that unblocks testing anything else.

1. `otel-env-block.ts:11-25` — add `pi` to `SOURCE_TYPE_BY_TOOL`, and the `pi`
   case to `tool-env.ts`. Until both exist, `langwatch pi` exits 501 and nothing
   downstream can be exercised by hand.
2. `platform-tool-policy.ts:23-30` and `:49`, then the server twin
   `platformToolPolicy.service.ts:27-34` and `:45`.
3. The registry matcher and its test — `agents/pi.ts`, appended last in
   `agents/index.ts:22-29`. Write the negative test first: bare `pi` must not
   match `com.anthropic.claude_code.events` or `copilot-cli`.
4. The session reader, modelled on `codex-rollout-otlp.ts` and wired at
   `wrapper.ts:741-770`, renaming the shared parts off `codex` rather than
   copying them.
5. The remaining registration sites, worked from the list in #8128 — not from
   compiler output, which stays silent for all of them.

Branch: `worktree-shiny-zooming-kahn`. One pull request, referencing #8128.

The full commit-by-commit expansion of these five steps — twenty-one rungs, each
naming its files, the scenarios it binds and the command that proves it — is
`132-implementation-ladder.md`. Three refusals it found are corrected below.

### Three refusals this ADR missed

Cutting the ladder surfaced three places that refuse or misbehave before capture
can work. Step 1 above is therefore incomplete as written: removing the two 501
refusals gets past the command-line tool and straight into a server refusal.

Each was checked by reading the code, not inferred from the ladder. What was run
and what came back:

| Claim | Command | What it returned |
|---|---|---|
| The mint refuses pi | `grep -n 'PERSONAL_INGEST_SOURCE_TYPES\|isWrappedTool\|IngestionKeySourceNotAllowedError' platform/app/ee/governance/services/ingestionKey.service.ts` | `:214 if (!isWrappedTool(sourceType))`, `:215 throw new IngestionKeySourceNotAllowedError(sourceType)`, and `:655 function isWrappedTool` reading the list at `:51`. pi is not in that list. |
| The policy check is skipped | Read `platform/app/src/server/routes/auth-cli.ts:2578-2603` | `policedSlug` is `undefined` when the source type has no entry, and the `allowOtelDirect` branch is inside `if (policedSlug)`. No entry means the check never runs. |
| The drift test hard-fails | Read `sdks/typescript/src/cli/__tests__/feature-map-drift.unit.test.ts:1-45` | It reads `program.ts` from disk, imports `PLUMBING_COMMANDS`, and asserts every top-level command has feature-map coverage. |

These are reads, not test runs — no test can be run for pi until pi exists in
the code. The three become executable assertions at ladder rungs 3, 2 and 5.

- **The personal ingestion key mint refuses pi.**
  `ingestionKey.service.ts:214-215` — `isWrappedTool("pi")` is false, so the mint
  throws `IngestionKeySourceNotAllowedError`. Adding pi to
  `PERSONAL_INGEST_SOURCE_TYPES` belongs in step 1's group, not step 5's list.
  Issue #8128 does name this file, but among the sites to extend rather than as
  something that throws.
- **A command-registration drift test hard-fails on pi.**
  `sdks/typescript/src/cli/__tests__/feature-map-drift.unit.test.ts` parses
  `program.ts` and fails the moment pi is registered without a matching
  `PLUMBING_COMMANDS` entry. This qualifies §6's claim that nothing outside the
  edited file breaks: two source-scanning tests do break — they are simply not
  the compiler. The app-side twin is on the record in #8128; this one was not.
- **The direct-telemetry policy check is skipped for pi, silently and
  permissively.** `PLATFORM_TOOL_SLUG_BY_SOURCE_TYPE`
  (`platformToolPolicy.service.ts:88`) is read at `auth-cli.ts:2582-2603`. With
  no pi key the resolved slug is undefined, the `allowOtelDirect` branch never
  runs, and an organisation that switched pi's direct path off still mints the
  key. This is the same silent-permissive failure §7 flags for
  `PLATFORM_TOOL_POLICIES`, on a different map, server-side, so the
  command-line tool's own policy entry does not cover it. It is folded into the
  ladder's rung 2, beside the entry that rung already edits.

Ruled out after checking, and unchanged: the mint route takes `source_type` as a
free-form string (`auth-cli.ts:2379`), and `coding-agent-source-type.ts:27`
passes an unknown agent through untouched.

## Revisions

| Version | Date | Captain | What changed and why |
| --- | --- | --- | --- |
| v1 | 2026-09-14 | Sergio Esteban | First draft. Capture was built on a pi extension emitting telemetry as events happened, on the reasoning that live events are richer than a file and that other vendors had taken the extension route. |
| v2 | 2026-09-14 | Sergio Esteban | Phase 5 red team returned refuted on all six lenses. The extension design was dropped for reading pi's session JSONL. Four defects were decisive, each verified against pi's shipped `dist/` rather than its docs: the extension can hang pi at exit indefinitely, can crash it through an unhandled rejection, loses sessions on three exit paths that skip shutdown entirely, and has no ordering guarantee. The losing argument, recorded because it was reasonable: an extension sees turn boundaries directly, while a file reader has to infer them. It lost because a capture path that can freeze the user's editor is not worth better turn boundaries. |
| v3 | 2026-09-14 | Sergio Esteban | The red team's own claim that five of the sixteen registration sites would fail the build was tested and disproved — `pi` was added to the `CodingAgent` union and `pnpm typecheck:all` run against a clean baseline, giving zero new errors. §6 was rewritten around the measurement and the reason for it. A refuted design and a refuter's wrong number are separate things; both are on the record. |
| v4 | 2026-09-14 | Sergio Esteban | `/ruthless-review` pass. Four wrong file:line citations corrected, including a self-contradiction between §6 and §7 on the same symbol. The session-file figures were replaced with counted values: 132 rows, 130 with a `parentId`, 43 assistant turns, $3.4405 total, 5 turns at exactly zero. Gates table and this log added — Phase 4 requires both and the draft shipped without them. |
| v5 | 2026-09-14 | Sergio Esteban | Spec red team returned refuted on all five lenses against `specs/coding-agent/pi-session-capture.feature`. §8 was the only decision found actually wrong, and only in part. Corrected: lineage is kept, not dropped — the parent path resolves to an id by opening the parent file's first line, which reuses the header reader capture already needs, and a deleted parent stores null against an already-nullable field. Removed: the claim that resuming a session records a parent. `session-format.md:3` and `:197` show resume appends in place and writes no `parentSession`, so there is no second session to link. `isFork` was redefined as "the header carries a `parentSession`", because pi does not distinguish fork from clone and the model never asks it to. The losing argument, recorded because I initially accepted it: drop lineage entirely, since a user can delete the parent file. It lost because the field is already nullable — a missing ancestor is an ordinary outcome, and one deletable input does not justify discarding the feature. The spec was rewritten from 25 scenarios to 28, every one tagged `@unimplemented`, and the file added to `LEGACY_INERT` with a note to retire the entry on the commit that binds the first scenario. |
| v6 | 2026-09-14 | Sergio Esteban | Second spec red team, four lenses, all refuted. No decision changed; four factual claims did, each measured against pi's shipped `SessionManager` rather than its docs. (a) pi does **not** write each turn as it goes: it buffers until the first assistant reply, so a session abandoned before that leaves no file and capture must treat an absent file as normal. (b) A current-version file only ever grows — three runs, same inode, byte-exact prefixes — but opening a session from an older pi rewrites it in place once, 874 → 869 bytes, so the reader must re-check size each pass instead of trusting an offset. (c) **New hazard, previously unstated:** a fork copies the parent's row identifiers verbatim, so de-duplication must key on (session id, row id); keying on row id alone would silently drop a branch's inherited history. (d) The session directory has three sources, not one; the draft specified only the flag, and the other two would have captured nothing. §7 grew from four surfaces to seven: the settings tile runs on a chain of four lists of which only the write gate was in scope, and the mapping from a saved choice to a tool slug fails silently — registering pi in one and not the rest reproduces the `claude_cowork` half-registration this ADR cites as its own warning. Site count sixteen → nineteen. The 85% reuse figure was narrowed: it covers discovery, tailing and transport, not the turn-content event builder, which is net-new. The spec went 28 → 33 scenarios (three of them outlines): 18 of the previous 28 could not fail and were rewritten, merged or dropped, and the holes above were filled. The losing argument, recorded because it was mine: that the two governed-tool lists hold different kinds of thing and their agreement did not need a scenario. They hold the same seven slugs, byte-identical, and the Gates table already demanded that test — the scenario was restored. |
| v7 | 2026-09-14 | Sergio Esteban | Commit ladder cut: `132-implementation-ladder.md`, twenty-one rungs covering all 33 scenarios, each naming its files, bound scenario titles and proving command. No decision changed. Three refusals the ADR had missed were found while cutting it and are recorded under the implementation entry point, each verified in the code rather than inferred: the personal ingestion key mint throws for pi (`ingestionKey.service.ts:214-215`), a command-registration drift test hard-fails the moment pi is registered (`feature-map-drift.unit.test.ts`, qualifying §6's claim that nothing outside the edited file breaks — two source-scanning tests do, they are simply not the compiler), and the direct-telemetry policy lookup skips its check entirely for an unmapped tool (`platformToolPolicy.service.ts:88` read at `auth-cli.ts:2582-2603`), so an organisation that switched pi's direct path off would still mint the key. That third one is the same silent-permissive failure §7 already flags, on a map §7 does not mention. Two corrections of record: three spec scenarios are outlines, not two; and the registration-site count of nineteen does not reconcile with the ladder's twenty distinct symbols — the ladder works from the symbols and the discrepancy is not yet chased. Ordering consequence worth naming: the rename of the shared reader parts off `codex` is rung 6, before the pi reader exists. Deferring it is precisely how the duplicated reader §5 rejects gets shipped anyway. |

## References

- Related ADRs: 056 (session aggregate, ordered per-agent registry), 039 (slug
  naming, wrapper reuse, extractor chain), 066 (projection reads from
  ClickHouse), 071 (immutable session storage), 087 (trace summary storage), 018
  (unified observability substrate)
- Issue: https://github.com/langwatch/langwatch/issues/8128
- Follow-ups: #8129 (repo changes), #8130 (spans), #8131 (governance), #8132
  (plain `pi` runs), #8133 (capture health), #8134 (agent list source of truth),
  #8135 (public onboarding)
- pi session format: `docs/session-format.md` in `@earendil-works/pi-coding-agent`
- pi extension API: `docs/extensions.md`, same package (rejected path, kept for
  the record)
- Precedent implementation: `sdks/typescript/src/cli/utils/governance/codex-rollout-otlp.ts`
  and its wiring at `sdks/typescript/src/cli/utils/governance/wrapper.ts:741-770`
- Spec: `specs/coding-agent/pi-session-capture.feature`
