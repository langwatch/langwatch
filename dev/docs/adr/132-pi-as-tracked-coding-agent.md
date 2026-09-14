# ADR-132: pi as a tracked coding agent

**Date:** 2026-09-30

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
one row per message with role, content, model, provider, stop reason, timestamp
and tool name; `usage` on assistant turns with tokens split four ways and
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
the user's machine" constraint without qualification, and it captures a plain
`pi` invocation launched inside a wrapped shell, not only ones we started.

`--session-dir <dir>` lets a user relocate the sessions directory. When it is
present in the wrapped arguments we read from there; the flag is parsed from
`toolArgs`, not guessed.

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

**6. The stored agent id is `pi`. No database migration; sixteen code sites.**

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

The reason matters more than the number. None of the sixteen lists derive from
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
compiler output. Collapsing the sixteen lists onto one source of truth is a
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
asks a human to keep the two in sync and nothing enforces it. All four are part
of this change, not follow-ups.

**8. One pi session is one LangWatch session. Lineage comes from the file.**

| Field | Source |
| --- | --- |
| `sessionId` | the `id` in the session file header |
| `parentSessionId` | the parent session's header `id` |
| `isFork` | the child branches from a non-terminal `parentId` in the parent |

pi is the first agent to populate `parentSessionId` and `isFork`
(`coding-agent-session.types.ts:90`), which the model has carried unused.

The earlier draft mapped `parentSessionId` to the extension's
`previousSessionFile`. Three defects, all now avoided by reading the header id
instead: a file path is not a session id and would never have joined to any
stored `SessionId`; it embeds the user's home directory and project path into
ClickHouse; and it is not unique across machines. The field is once-set at
`derivation.ts:562`, so a wrong value would have been permanent.

`--fork` and `--session` also fork and resume at startup, not only mid-session.
Reading the file covers both without a special case.

**9. Where a number has no source, we show nothing — not zero.**

pi reports cost and tokens. It does not report lines changed, commits, or pull
requests. Those stay empty rather than showing a confident zero.

This has a known limit worth stating: some assistant turns in real pi sessions
record `cost.total` of exactly `0`. That is pi's own gap, not ours, and it
renders identically to a genuinely cheap turn. See §Known gaps.

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
| The sixteen registration sites | Yes | Large: a missed site ships a half-registered agent that fails at save time, as `claude_cowork` did | Human review against the enumerated list in #8128. The compiler catches none of them — measured, see §6. This is the weakest gate in the table and the reason #8134 exists. |
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
process and because the data is already durable before we look at it. A crash
that would have lost the tail loses nothing.

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

**Merging a resumed session into its parent.** Rejected: pi keeps them apart,
and a merge that degrades to a split when the pointer breaks produces two
shapes with no way to tell them apart afterwards.

## Consequences

Positive: pi users get transcript, cost and session boundaries with one command,
including plain `pi` runs inside a wrapped shell. pi becomes the first agent to
populate session lineage. Our own use of pi becomes visible to us. The capture
path cannot crash or stall the user's editor session, which is not true of the
alternative and is now true of pi before it is true of some agents we already
ship.

Negative: we depend on pi's session file format. It is versioned and migrating,
which is better than the event API, but it is still not a contract written for
us. We now own a second file-tailing capture path in the CLI, and the shared
parts must actually be shared rather than copied — a copy here is the failure
mode, not the abstraction.

Neutral: sixteen registration sites is the real cost of adding any agent, and
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

## Revisions

| Version | Date | Captain | What changed and why |
| --- | --- | --- | --- |
| v1 | 2026-09-30 | Sergio Esteban | First draft. Capture was built on a pi extension emitting telemetry as events happened, on the reasoning that live events are richer than a file and that other vendors had taken the extension route. |
| v2 | 2026-09-30 | Sergio Esteban | Phase 5 red team returned refuted on all six lenses. The extension design was dropped for reading pi's session JSONL. Four defects were decisive, each verified against pi's shipped `dist/` rather than its docs: the extension can hang pi at exit indefinitely, can crash it through an unhandled rejection, loses sessions on three exit paths that skip shutdown entirely, and has no ordering guarantee. The losing argument, recorded because it was reasonable: an extension sees turn boundaries directly, while a file reader has to infer them. It lost because a capture path that can freeze the user's editor is not worth better turn boundaries. |
| v3 | 2026-09-30 | Sergio Esteban | The red team's own claim that five of the sixteen registration sites would fail the build was tested and disproved — `pi` was added to the `CodingAgent` union and `pnpm typecheck:all` run against a clean baseline, giving zero new errors. §6 was rewritten around the measurement and the reason for it. A refuted design and a refuter's wrong number are separate things; both are on the record. |
| v4 | 2026-09-30 | Sergio Esteban | `/ruthless-review` pass. Four wrong file:line citations corrected, including a self-contradiction between §6 and §7 on the same symbol. The session-file figures were replaced with counted values: 132 rows, 130 with a `parentId`, 43 assistant turns, $3.4405 total, 5 turns at exactly zero. Gates table and this log added — Phase 4 requires both and the draft shipped without them. |

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
  and its wiring at `wrapper.ts:741-770`
