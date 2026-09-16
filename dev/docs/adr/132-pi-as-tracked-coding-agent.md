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
`cost.total`; and a `parentId` on every row but two, forming the fork tree.
The two are the header and the row immediately after it, which in the measured
session is a `model_change` — not a message, as an earlier draft of this
paragraph said. Counted, not estimated: 132 rows, 130 with a `parentId`, 43
assistant turns, every one of them carrying a `cost.total`, summing to $3.4405
— of which 5 were exactly zero, and correctly so (see §9). The same session
changed model three times and used two different providers, which is §4's
"pi is a host" observed rather than argued.

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

Those defaults are the wrong answer for pi, and dangerously so. pi's entry is
`{ allowVk: false, allowOtelDirect: true }`, not the permissive default — see the
first Invariant for the probes, and for why we do not route pi through the
gateway even though a route exists.
It follows that `tool-env.ts` needs no `pi` case at all: with `allowVk: false` the
downgrade at `wrapper-mode.ts:269-277` turns any gateway preference into ingestion
before the 501 can fire, so the 501 above is unreachable for pi rather than
something to fix. Only the `otel-env-block.ts` half of the 501 problem is real.
The `case "pi"` an earlier rung added there is therefore **removed**, not merely
left unreachable: its comment claimed pi reads the OpenAI-compatible pair on every
lane, which is false, and dead code carrying a false claim comes alive the moment
someone flips the flag back.

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

Some assistant turns in real pi sessions record `cost.total` of exactly `0`.
An earlier draft called that pi's own gap. It is not a gap. All five such turns
in the measured session ended with `stopReason: "error"`, `totalTokens: 0`, and
a provider rejection recorded against them — the request was refused before
anything was billed, so zero is the correct number and not a missing one. A
genuine zero and an absent measurement are different facts, and the reader must
keep them apart for exactly that reason.

The distinction cuts one level deeper, and the reader must honour it. A turn
whose `cost` object is **missing entirely** — because pi did not write one, or
because a future pi renames the field — is absent, and is recorded as absent. It
is not zero. Only an explicit `cost.total` of `0` is recorded as zero. Collapsing
the two would make a capture failure indistinguishable from a cheap session,
which is the exact reading error this decision exists to prevent. Both halves
have their own scenario, bound at rung 10 of the ladder.

## Invariants

- **One capture path per run, and for pi that path is always ingestion.** The
  no-double-trace rule (`wrapper-mode.ts:18-21`) holds by the same guard codex
  uses: the reader runs only when `modeResult.mode === "ingestion"`
  (`wrapper.ts:743`). For codex, the other branch is a working gateway. **For pi
  we do not take the other branch, and that is a cost we decline to pay rather
  than a thing pi makes impossible.** Exactly two variables have no effect:
  `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`. pi's openai provider hardcodes
  `https://api.openai.com/v1` (`pi-ai/dist/providers/openai.js:9`) and its
  anthropic provider hardcodes `https://api.anthropic.com`
  (`pi-ai/dist/providers/anthropic.js:43`); neither reads an override. Probed
  against pi 0.85.1 with nothing listening on the target
  port — a connection error would have proven pi obeyed, and instead both probes
  returned genuine vendor 401s:

  ```
  OPENAI_BASE_URL=http://127.0.0.1:41777/v1 OPENAI_API_KEY=sk-bogus… pi -p --model openai/gpt-5-mini "say hi"
  → OpenAI API error (401): Incorrect API key provided: sk-bogus********  [api.openai.com]
  ANTHROPIC_BASE_URL=http://127.0.0.1:41777 ANTHROPIC_API_KEY=sk-ant-bogus… pi -p --model anthropic/claude-haiku-4-5 "say hi"
  → 401 {"type":"authentication_error","message":"API key is invalid."}   [api.anthropic.com]
  ```

  That pair is the whole of what is ignored, and the rest of pi's surface is
  open. `AZURE_OPENAI_BASE_URL` **is** honored, and it outranks the model's own
  address: `resolveAzureConfig` reads the variable first
  (`pi-ai/dist/api/azure-openai-responses.js:164`) and reaches `model.baseUrl`
  only as its third fallback (`:170`), and pi documents the variable in its own
  help (`pi-coding-agent/dist/cli/args.js:385`). pi's whole agent directory also
  relocates through `PI_CODING_AGENT_DIR` (`pi-coding-agent/dist/config.js:397`,
  read by `getAgentDir()` at `:411-417`), which we have driven live: pi was
  pointed at a local endpoint and sent `Authorization: Bearer <virtual key>`,
  with nothing written to the user's real pi install. Our own ladder already
  uses the sibling variable `PI_CODING_AGENT_SESSION_DIR`, so this family of
  variables plainly works.

  We choose ingestion anyway, and the price is what decides it.
  `PI_CODING_AGENT_DIR` relocates `auth.json` and `settings.json` along with
  `models.json`, so redirecting pi would shadow the user's own pi sign-in and
  their settings for the length of the run. That is changing a tool we were only
  asked to observe, to buy a second capture path we do not need. So pi is
  `{ allowVk: false, allowOtelDirect: true }`: ingestion-only, the same
  shape as `code`, and the existing downgrade at `wrapper-mode.ts:269-277` turns a
  gateway preference into ingestion with an accurate notice. Leaving pi on the
  permissive default would have been silent total data loss for every user who has
  a gateway key: gateway mode selected, the OpenAI-compatible base URL ignored,
  gateway sees nothing, and the reader skipped because the mode was not ingestion.

  The earlier claim here — that `langy` proves pi honors a swap (`spawn.go:23`) —
  was a misreading, though its conclusion landed nearer the truth than the v10
  correction that replaced it. `spawn.go` spawns the langy-worker wrapper, not pi;
  the wrapper writes the base URL into a generated pi `models.json`
  (`services/langyworker/src/models.ts:105-121`), a config file rather than an
  env var. Writing one of those into the user's pi install is what the "no writes
  to the user's machine" invariant below forbids.
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
| Posting captured turns to the ingestion endpoint | **No** — the transcript is the user's source code, and it leaves the machine | Large | A test asserts the streamer runs **whether or not** a virtual key is present. **This row said the opposite until v10** — it demanded a test asserting the streamer is `null` when a key is present, which is the pre-v10 belief that pi honors an OpenAI-compatible base-URL swap. pi does not honor `OPENAI_BASE_URL` or `ANTHROPIC_BASE_URL`, and we do not take the route that would work (see revisions v10 and v12), so a key-holder has no gateway capture to fall back on and that test would have pinned total silent data loss for every paying customer. A gate that names the wrong assertion is worse than an empty cell: implementation and review both read this table, so it would have been built to order. |
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

**Cost must not fail to the worse mode, and now cannot.** A missing or renamed
cost field would naturally read as `0` and render as a real $0.00 rather than as
absent — a capture failure wearing the face of a cheap session. The reader
built in rung 8 makes that collapse impossible to write rather than merely
discouraged: an unreported cost has no total field at all, so the one-character
mistake that turns absent into zero does not compile. Genuine zeros still occur
and are still correct — a turn the provider rejected before billing is honestly
$0.00 — but they are now a different value from a measurement we never got.

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

Positive: pi users get turn-by-turn usage, cost and session boundaries with one
command. Not transcript: this line said "transcript" and was wrong about our own
build. The events carry each turn's speaker, timing, model and sizes and none of
its text (`pi-turn-events.ts:144`), and the session record they fold into has no
field for a conversation. Readable conversation lives on the span lane, which
§4 declines for pi on the stated grounds that pi's file has no span parentage;
moving pi's message text there is issue #8173, filed alongside #8161.
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

A review lesson, learned here and not specific to pi: **a leak assertion placed
after an identity assertion in the same test is unreachable whenever the break
moves the identity too.** Rung 13's privacy guarantee — the parent's file path,
which contains the user's home directory, must reach no emitted attribute — was
asserted at the end of a test that first checked the resolved parent id. Both
breaks that actually move a path into that id sailed past it: making the raw
path the fallback when the parent header cannot be read left that very test
GREEN (it reddened one unrelated test), and using the path as the id outright
reddened it on `expected '/var/folders/…' to be '01a09b6b-…'` — an identity
message from a line above the payload checks. The guarantee was provable by
exactly one mutation of seven, the one that leaves the id correct and stamps the
path beside it. That is a guarantee held by luck. The fix is structural and
cheap: give an assertion with a security consequence its own test, with nothing
in front of it that can throw. Both breaks now fail on the payload assertion
itself. When reviewing a test that ends in a privacy or leak check, read upward
and ask what else in it can throw first.

A second lesson, about specs rather than tests: **a scenario that asserts
something the system does not do should be deleted, not parked.** "Measurements
pi never reports are left blank rather than shown as zero" was refused three
times by three rungs working independently — vacuous at the builder, false at
the projection, and finally unbindable at the agent definition, where the
proposed fix (`?? 0` on the pi definition) could not have compiled because
`CodingAgentDefinition` has no value-mapping field at all. The measurements are
bare `number` initialised to zero and returned unconditionally
(`coding-agent-session.types.ts:306-309`,
`coding-agent-session.derivation.ts:1328-1379`); they are never blank. The real
blanking is a display guard over zeros in `SessionView.tsx:518-524`, `:544` and
`:547`, agent-agnostic and older than pi — a test of it passes with every line of
pi deleted, which is the rung-4 vacuity test failing. `@unimplemented` is a
queue, not a graveyard: a false claim left in a spec teaches the next reader the
wrong invariant whether or not a gate measures it, and the only way to make this
one true would have been to change production nullability to fit the sentence.
Note that the behavior it reached for is already out of scope below (#8129).

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
| Session Outcome stat gate — not pi-specific, belongs in `specs/trace-drawer/` | to file |
| Any change to langy | none — explicitly untouched |

## Implementation entry point

Start here, in this order. The first step is not the interesting one — it is the
one that unblocks testing anything else.

1. `otel-env-block.ts:11-25` — add `pi` to `SOURCE_TYPE_BY_TOOL`. Until it
   exists, `langwatch pi` exits 501 `otel_direct_unsupported` and nothing
   downstream can be exercised by hand. **Add a `case "pi": return {}` to
   `buildOtelEnvBlock` in the same change** — being in the slug table must not
   mean pi's child gets an env block. Skipping this hands a live ingest token to
   every process in the session; see Revision v9, which reverses the original
   wording here. `tool-env.ts` gets **no** `pi` case: with `allowVk: false` the
   downgrade at `wrapper-mode.ts:269-277` reaches ingestion before the gateway
   501 can fire, so that half of the problem is unreachable for pi rather than
   something to fix — see Revision v10.
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
| v8 | 2026-09-14 | Sergio Esteban | Three factual corrections, all found by builders during implementation and all re-measured against the real session file before being accepted. (a) §Context said a `parentId` sits on every row but the header and the root message. Two rows lack one, and the second is a `model_change`, not a message — the first *message* row is parented. The count of 130 was right; the description of which two was wrong, and it was wrong in a correction I had already made once. (b) §9 and §Known gaps called the five zero-cost turns "pi's own gap". They are not a gap: all five ended with a provider rejection, zero tokens billed, so $0.00 is the correct figure. The wording overstated a limitation that does not exist, and the spec's own phrasing was already the accurate one. (c) §Known gaps warned that cost fails to the worse mode, an absent measurement rendering as a real zero. Rung 8 made that collapse impossible to express rather than merely discouraged — an unreported cost carries no total field, so the mistake does not compile. The gap is closed, not merely noted, and the entry now says so. Also recorded, because it will bite the next rung: each row carries two clocks in two different units, and the shipped tool-result rows carry no usage at all despite the format documentation saying they may, so any assertion about work inside tools has no ground truth on this machine. |
| v9 | 2026-09-14 | Sergio Esteban | **A decision reversed, not a correction.** §7 said pi takes the generic endpoint-and-headers env block because pi would simply ignore vars it does not read. That reasoning was wrong and it shipped: rung 2 encoded it as an assertion (`wrapper-mode.unit.test.ts`) that the ingest token *was* handed to pi's child. It stopped one step short of the child's environment not being pi's alone. `wrapper.ts:707` merges the block into the child env, and on an interactive shell `buildShellReapply` (`wrapper.ts:296-312`) re-`export`s it into the session, so every process a developer starts inside `langwatch pi` — a dev server, a test run, their own app — inherits a live ingest token and an endpoint, and anything OTel-instrumented among them posts spans to us authenticated as pi. This is the hazard `ingestKeyProvenance.utils.ts:150-158` already documents for the VS Code extension; that mitigation is a server-side scope gate which early-returns for any other source type (`:181-183`), so it would never have covered pi. Confirmed by execution, not by reading: a spawned child was observed holding the bearer token, and pi was shown to be indistinguishable from a typo'd tool slug, both getting the same two keys. Also verified in the other direction — pi ships no exporter at all (zero hits for `OTEL_`, `otlp` or `opentelemetry` across the 884 files of its shipped `dist/`), so the block bought no capture in exchange for the exposure. **New decision: pi receives no env block whatsoever, the only tool for which that is true.** Capture is unaffected; the endpoint and token stay in the mode result (`wrapper-mode.ts:600-601`) for the post-exit transcript POST. Receiver-side filtering was considered and rejected: the exposed token is itself the harm, independent of which spans get accepted. **A second finding falls out of the same root cause.** `SOURCE_TYPE_BY_TOOL` was doing two unrelated jobs — naming a mint source type, and gating which tools may be instrumented. pi needs the first and must fail the second, but `instrument.ts:56` read the one table for both, so `langwatch instrument pi` passed validation, passed the `allowOtelDirect` default, minted a real ingest key and wrote persistent wiring that captures nothing forever; the command's own help string (`program.ts:487`) still advertised the older, correct set. Fixed by deriving instrumentability from the env block (`exportsTelemetry`) rather than adding a second hand-kept list — a tool handed no vars is a tool with nothing to instrument, by construction, so the two cannot drift. Rung 5 had already declined to touch the installer for this reason and named the help string as the tell; that judgement was right and this closes it properly. Two scenarios added to the spec, both bound and both falsified. |
| v10 | 2026-09-14 | Sergio Esteban | **A second decision reversed, and the load-bearing factual claim of §7 killed.** The ADR asserted that pi honors a base-URL swap, cited `langy` as proof (`spawn.go:23`, `OPENAI_BASE_URL`), and concluded that gateway mode "will genuinely capture once §7 lands". Every part of that is false. pi ignores base-URL environment variables outright: each catalog model carries a hardcoded `baseUrl` in pi's shipped `dist` and both client factories pass it explicitly into the vendor SDK constructor, so the SDK's own `readEnv("OPENAI_BASE_URL")` / `readEnv("ANTHROPIC_BASE_URL")` default is never reached. Proven by execution against pi 0.85.1 with **nothing listening** on the redirect target, so a connection error would have proven pi obeyed: both probes instead returned genuine vendor 401s from `api.openai.com` and `api.anthropic.com`. The `langy` citation was a misreading — `spawn.go` spawns the langy-worker wrapper, not pi, and the wrapper injects the base URL through a generated pi `models.json` (`services/langyworker/src/models.ts:105-121`), a config file, not an env var. **Consequence, and the reason this is a P1 rather than a documentation fix:** pi was left on the permissive default `{allowVk: true, allowOtelDirect: true}`, `wrapper-mode.ts:247-257` resolves `hasVk → gateway`, and gateway and ingestion are mutually exclusive (`wrapper-mode.ts:18-21`), so every user holding a gateway key would have got gateway mode selected, the base URL ignored, the gateway seeing nothing, and the session reader skipped because the mode was not ingestion — silent total data loss, no error, with a reassuring notice printed. It would have hit exactly the users most likely to have a key, and looked like working software. **And it is worse than data loss: it is credential exposure.** The openai lane does not merely fail to capture — it sends the LangWatch virtual key to `api.openai.com` as an OpenAI key, and the probe has the vendor echoing it back in the 401 body. So the shipped state leaked our own credential to a third party on every run of a lane we could not capture. **New decision: pi is `{ allowVk: false, allowOtelDirect: true }` — ingestion-only, the same shape as `code`.** The existing downgrade at `wrapper-mode.ts:269-277` then converts a gateway preference into ingestion with an accurate notice, and no new mechanism is needed. It further follows that `tool-env.ts` needs no `pi` case at all: the downgrade fires before the 501 can, so half of the two-501 problem §7 opens with is unreachable for pi rather than something to fix. Recorded because the process point matters more than the fix: this was found by an adversarial refuter sent to kill a *different*, weaker finding of mine — I had suspected doubled capture, which would at least have been visible. The refuter refuted my finding and returned a worse one, and both probes were then reproduced independently by the lead before the fix was written. **Narrowed by v12: the probes were sound but the generalisation drawn from them was not. Read "pi ignores base-URL environment variables outright" above as "pi ignores `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`", which is all the two probes tested. The decision recorded here is unchanged.** |
| v11 | 2026-09-14 | Sergio Esteban | **A new invariant, and the cost number was wrong in the one direction nobody checks.** The ADR decided the read buffer is "memory, not storage" and treated the reader's seen-set as sufficient de-duplication. It is sufficient *within* a run and worthless across them: the seen-set dies with the process, a resumed session's file has a modification time that has moved so the file-level window admits it, and the new process starts at row zero — so run N re-sent every turn the session had ever held. Nothing downstream removes the repeat, and the near-miss is worth recording because it looks like it should: `recordId` is a content hash (`log-processing/canonicalLog.ts:551`) and both commands stamp `idempotencyKey: tenantId:recordId`, so `event_log` is a ReplacingMergeTree ordered on that key and a re-read would collapse the duplicate — but the session fold sets `refoldOnOutOfOrder: false` (`codingAgentSession.foldProjection.ts:282`) on the stated grounds that its accumulators commute, so it never re-reads, and `dropAlreadyApplied` filters on `event.id`, fresh per append, not on the idempotency key. Sums commute; they do not de-duplicate. The subscriber's own guard is `ttlMs: 60_000` (`codingAgentLogFactsDispatch.subscriber.ts:47-52`), which catches a resume inside a minute and nothing realistic. **Scope: unbounded and invisible** — a turn was billed once per `langwatch pi` run touching its session, so ten resumes bill turn one ten times, with `modelCalls`, tokens and every other accumulator inflating identically. Cost is merely the one a user would notice, and it inflates upward, which reads as real spend rather than as a bug. Measured end to end: two captures against one growing file sent `[0.11, 0.22]` then `[0.11, 0.22, 0.33, 0.44]`, and driving the real reducer `applyLogToCodingAgentSession` with those contributions gave `costUsd 1.43 / modelCalls 6` against a truth of `1.10 / 4`, the re-sent records byte-identical down to `timeUnixNano`. **New invariant: capture keeps only turns at or after the run's start**, filtering on pi's entry clock, which every emitted event already carries — a row without a usable timestamp is dropped before it becomes an event (`pi-turn-events.ts:353`), so the filter has no fallback to get wrong. This makes the file-level "only what this run touched" rule true row by row and needs nothing kept on disk, so the "memory, not storage" decision stands rather than being reversed. The rejected alternative was the obvious one — persist the cursor and seen-set per session in the CLI state directory, the shape `hook-state.ts` already uses — which works but contradicts that decision and starts writing to the user's machine for a problem the clock already answers. The accepted cost, stated because it is a real loss: a turn written before the run started is never captured, so turns a crashed wrapped run never posted are not recovered by resuming it — which is this module's existing position on a crash, not a new one. The spec gained one scenario; it had a section header promising "and only once" and a scenario asserting a turn is not recorded twice, both of which the shipped code satisfied within a run while failing across runs, which is why neither caught this. Falsified in both directions before acceptance: with the filter neutered the new test reports run two sending four turns where two are new. Two test files were carrying fixtures frozen at a fixed past instant while the wrapper's window starts at `now`; their rows are now stamped when written, which is what pi does and what they were always meant to model. Found by a refuter sent to kill this exact claim, which confirmed it instead. |
| v12 | 2026-09-16 | Sergio Esteban | **No decision changed, but the reason under one of them did, and it had hardened into a false claim repeated across four documents.** v10 proved two probes and then wrote down a third, wider thing: that pi ignores base-URL environment variables as a class, and therefore that routing pi through the gateway is impossible. Testing against pi's shipped code says otherwise. `AZURE_OPENAI_BASE_URL` **is** honored, and it outranks the model's own address: `resolveAzureConfig` reads the variable first (`pi-ai/dist/api/azure-openai-responses.js:164`) and reaches `model.baseUrl` only as a third fallback (`:170`), with pi documenting the variable in its own help (`pi-coding-agent/dist/cli/args.js:385`). What is genuinely ignored is narrower and is exactly what the two probes covered: `OPENAI_BASE_URL` and `ANTHROPIC_BASE_URL`, hardcoded at `pi-ai/dist/providers/openai.js:9` and `pi-ai/dist/providers/anthropic.js:43` with no override read on either. Routing pi is possible by a route nobody had looked for: `PI_CODING_AGENT_DIR` (`pi-coding-agent/dist/config.js:397`, read by `getAgentDir()` at `:411-417`) relocates pi's whole agent directory, and pi was driven live against a local endpoint sending `Authorization: Bearer <virtual key>`, with nothing written to the user's real pi install. This ADR's own ladder already uses the sibling `PI_CODING_AGENT_SESSION_DIR`, which should have been the tell that the family works. **The decision stands and its footing moves.** pi remains `{ allowVk: false, allowOtelDirect: true }`, ingestion-only, but no longer because routing cannot be done. It rests on the cost: `PI_CODING_AGENT_DIR` relocates `auth.json` and `settings.json` along with `models.json`, so redirecting pi would shadow the user's own pi sign-in and settings for the length of the run, which is changing a tool we were only asked to observe in exchange for a second capture path we do not need. Recorded as its own revision rather than as an edit to v10 because the process point is the durable part: a claim of impossibility is far more load-bearing than a claim of cost, and this one earned its authority from two true probes that never tested it. Every occurrence in §7, the Invariants, the Gates table, the ladder and the task list now says "we do not" and names the price, never "cannot". |

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
