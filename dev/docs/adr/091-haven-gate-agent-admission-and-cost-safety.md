# ADR-091: haven answers the agent's tool call; it never drives the agent

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-090](./090-machine-wide-resource-governance-for-parallel-agents.md) (the governor this is the entry point to), [ADR-064](./064-haven-cli-redesign.md) (the CLI surface `haven gate` and `haven run` join).

**Behavioural contract:** [specs/claude/agent-admission-gate.feature](../../../specs/claude/agent-admission-gate.feature), [specs/claude/llm-cost-safety.feature](../../../specs/claude/llm-cost-safety.feature).

## Context

ADR-090 gives the machine a governor. The governor is useless if nothing consults it, and the things that need to consult it are ten Claude Code sessions that cannot see each other, were not started by haven, and must not be started by haven.

Claude Code's hook surface is the seam. Hooks fire before tool calls, including inside sub-agents, and the direction of control is the one we want: the agent calls haven, haven answers, haven never invokes the agent.

Most of this ADR's contract claims were settled by probing a headless session against a scratch settings file rather than by reading docs, and two of them came back the opposite way to the previous draft.

**The matcher syntax works as written.** A `hooks.PreToolUse[]` entry with `matcher: "Bash"` and a `hooks[]` array of `{type: "command", command, timeout}` fires on the matching tool call. The payload carries `session_id`, `transcript_path`, `cwd`, `prompt_id`, `permission_mode`, `effort.level`, `hook_event_name`, `tool_name`, `tool_input` and `tool_use_id` — and, confirming the docs, no `agent_id` in a main session.

**`updatedInput` is honoured with `allow` and silently ignored with `defer`.** The same hook returning the same replacement input rewrote and ran the command under `allow`, and left the original untouched under `defer`, which merely handed the call back to the permission flow. The previous draft chose `defer` specifically to avoid widening permissions. That choice does not work, and the fallback it named is now the only path.

**Exit code 2 blocks the tool call, and a compiled Go panic exits with exactly 2.** (`go run` masks this — it reports the child's status and exits 1 itself, which is how the first check got it wrong.) `haven gate` will be Go, so the language's crash default is a machine-wide tool-call blocker.

**A rewritten command is visible to the model, and the model reacts to it.** In the probe the nested session ran the substituted command, noticed the output did not match what it had asked for, and flagged the environment as untrustworthy in its answer. A rewrap is not transparent.

The second duty has nothing to do with RAM. Prompt caching is a prefix match, and invalidating a prefix you were about to read costs the difference between a write and a read. **Which lifetime applies is decided by what kind of caller you are**, and a scan of 40 real transcripts on this machine — 14,121 cache-writing requests, ~53M cache-write tokens — comes back perfectly bimodal: sub-agent transcripts write `ephemeral_5m` 100% of the time, main-session transcripts write `ephemeral_1h` 100% of the time, and not one request writes both.

So a sub-agent pays a 1.25× write against a 0.1× read — a **1.15× premium**, about **$1.73** on a 300k-token prefix at Opus 5's input rate — and expires after five minutes idle. A main session pays a 2× write, a **1.9× premium**, about **$2.85**, and survives an hour. Sub-agents park cheaply per token but expire fast; main sessions park expensively but almost never expire.

That is directly readable from the payload the gate already receives: `agent_id` is present inside a sub-agent and absent in a main session. No inference required.

There is a related cost the spawn cap prices better than RAM does: a cache entry is readable only once the first response using it begins streaming, so N sub-agents launched in one turn share a prefix and all pay the write.

## Decision

**`haven gate` is a hook, and installing it is opt-in and per worktree.** It reads one JSON payload on stdin, answers, exits. It has two duties sharing one seam: machine admission (ADR-090) and prompt-cost safety.

A user-level registration would cover every session on the machine in one write, and that is exactly why it is not what ships: the hook changes how a *different* tool behaves, and haven does not get to assume that for every checkout a developer opens. `haven setup gate-hook` installs it into the worktree's own `.claude/settings.local.json`; `haven up` installs nothing. The cost is that governance is only where it was asked for — a worktree nobody ran `setup` in is ungoverned, and that is the developer's call to make rather than haven's.

**It reaches past `PreToolUse`, and the Decision names where.** `PreToolUse` is what ships and all `haven setup gate-hook` installs: admission and the command-shaped cost checks. The rest is the phase-2 surface, named here so each check has an event that could observe it rather than being specced against nothing — settings and instruction changes that arrive without a tool call (`ConfigChange`, `InstructionsLoaded`), turn-shaped observations (`PostToolBatch`, `Stop`) and sub-agent accounting (`SubagentStart`, `SubagentStop`). Every scenario needing one of those is parked `@unimplemented` in `specs/claude/llm-cost-safety.feature`, and they arrive with the telemetry that tells us which of the checks are worth building.

**It classifies narrowly and defers by default** — vitest, tsgo, biome, `next build`, `go build`, `docker build` are heavy; everything else returns `defer` after reading one cached file.

**It rewraps only where the permission boundary is already open.** Rewriting requires `allow`, and `allow` bypasses the permission system, so returning it for an arbitrary command would auto-approve — whenever the machine happened to be busy — something the user's rules would have prompted about. The gate therefore rewraps only when `permission_mode` already indicates auto-approval (`bypassPermissions`, `acceptEdits`, `auto`, `dontAsk`). Under `default` or `plan` it leaves the command untouched and falls back to observing and, at red, denying. This is a real reduction in reach, and it lands where it should: unattended fleets run in an auto-approving mode and are the case this ADR exists for, while an interactive session keeps its permission prompts and gets a warning instead of a rewrite.

**The rewrap passes the command as one escaped argument.** `tool_input.command` is a shell string, not argv, so splicing it after a `--` separator would leave everything past an `&&` outside the slot. It becomes `haven run --class heavy --sh '<escaped original>'`, addressed by haven's own absolute path because `make haven install` is optional and a rewrite that yields `command not found` has broken a working command in the name of fail-open. A command already wrapped is not wrapped again, or the outer holds the slot the inner waits for.

**A rewrapped command is admitted exactly once.** `haven run` exports a marker that `check-queue.mjs` honours by standing down, mirroring the `CHECK_SLOTS=0` rule #6598 already uses for `haven typecheck`.

**The rewrap announces itself.** Because the model can see the substitution and will distrust it, the replacement carries a description saying haven queued the command and why. An unexplained rewrite makes an agent doubt its own environment, which is a worse failure than a slow test run.

**Never exit 2, and never let the runtime choose the exit code.** The gate recovers panics in main, runs no goroutines on the decision path, and translates any abnormal termination into a deferring exit. Stated as a decision because the language default is the failure mode.

**A wait too long to serve becomes a background task, not a refusal.** This is the best available answer to "the queue is deeper than this caller's ceiling", and it is measured rather than assumed: `updatedInput` can set `run_in_background` on a Bash call, and a probe confirms the agent then gets control back immediately, reads haven's explanation out of the replacement `description`, and receives a completion notification with the exit code when the run finishes.

That dominates the alternatives. Blocking parks the agent past its cache floor. Refusing costs a turn and invites a retry that hits the same queue. Backgrounding does the work, keeps the agent free — so its cache never goes cold at all — and tells it the outcome later. While the run sits in the queue, `haven run` writes its position to stdout, so an agent that polls the background task sees live queue depth rather than silence. That is the closest thing to a push channel that exists: hooks are request/response, and a blocked agent makes no API calls, so there is nothing to push to.

**Backgrounding is scoped to the case where the alternative was a refusal**, because it breaks causality: an agent that runs tests and then edits based on the result gets an immediate return and could proceed as though they passed. Where the wait fits inside the caller's ceiling, the run queues inline and blocks, which preserves the ordinary contract. Where it does not, the agent was not going to get its result on this turn either way, so a background task is strictly better than a denial.

**Red still refuses**, because at red the machine cannot take the work at all — backgrounding it would just move the burst a few seconds later.

A deny that does happen is not free — it costs a turn — so the same command is not denied indefinitely.

**On the cost side the gate warns, and each check names its channel.** No primitive shows the model a price and still lets the action proceed — `systemMessage` reaches the developer and not the model, `ask` interrupts the developer, `deny` reaches the model but blocks. Warnings are therefore for the developer. High-certainty, high-value invalidations on a large prefix use `ask`; everything else uses `systemMessage`. Two things get `deny`: a tool call repeating identically with no intervening change, and a sub-agent spawn past the machine-wide cap.

**The repeat detector is scoped so it cannot break the red-green loop** — consecutive identical calls, no intervening file edit and no intervening different tool call, counted per session and reset on either.

**The spawn cap is allowed to lose count, and fails open when it does.** `SubagentStop` and `SessionEnd` provide the decrement, but `PreToolUse` fires before the permission check, so a rejected spawn is counted and never runs and drift is one-directional. Entries expire, and an unverifiable count admits — a stale-high counter refusing every spawn on the machine forever is the fail-closed outcome this ADR calls non-negotiable.

**Measurement precedes enforcement, and the measurement is not yet confirmed.** The repo's `.claude/settings.json` sets `OTEL_*` exporters and an endpoint, but no `CLAUDE_CODE_ENABLE_TELEMETRY` and no exporter auth, and the user-level settings set no OTEL keys at all — so whether any of this reaches LangWatch today is unconfirmed. Confirming that export and reading the cache-read to cache-creation ratio is the first deliverable; that ratio decides which cost checks are worth building.

## Rationale / Trade-offs

The alternative to a hook was an MCP server exposing the same decisions as tools. Rejected because it inverts the direction: an MCP tool is called when the model chooses to, so it governs only cooperative agents, and the runaway session that most needs governing is the one that stops asking.

The alternative to rewrapping was a lease keyed by `tool_use_id`, released on `PostToolUse` — workable, but needing a TTL, a reaper for sessions that die between the two events, and a second source of truth. Rewrapping needs none of that because the OS drops a flock when its holder dies. That argument survives for the Bash case. It does **not** extend to the spawn cap, where an Agent call has no process to hold a lock on, so that leg re-imports the bookkeeping this paragraph avoids elsewhere, bounded by expiry rather than eliminated.

**A ticketed queue was designed and then deliberately halved.** The proposal was a service counter: a refused caller takes a number, keeps its place across its absence, and is told when to come back. Two of its three parts are clearly right and are built. The caller is told its **position** and a **time to retry**, and that time is **capped by its own cache window** — which turns "never quote a moment the caller cannot afford" from a guideline into an invariant, since the ceiling already sits under the prompt-cache floor. A queue too deep to quote inside that window yields no hint at all and the run is backgrounded instead, rather than the caller being sent away with a comfortable lie.

The third part — actually *holding* the place — is not built. It is what fixes starvation, where a caller is repeatedly refused while others are served, and it is the only part that costs anything: a store, an expiry, a reclaim, and a reconciliation between who holds a place and who holds a slot. That is precisely the bookkeeping the paragraph above is pleased to have avoided, and a held place cannot lean on a flock, because a flock's whole property is dying with its holder while a reservation exists to outlive one.

It also has a failure mode none of the other mechanisms share: **it needs the model to cooperate.** A flock does not care what anyone believes. A held place is prose handed to a non-deterministic client that may return early, return late, lose the reference, or rephrase the command and try again.

So starvation is measured before it is solved. The doctor counts consecutive refusals of the same command, and if that number is ever meaningfully non-zero the reservation earns its cost. If it stays at zero, a subsystem was saved. This is the same discipline that corrected the cache TTL twice: build the cheap half, instrument the expensive half's justification, and let the measurement decide.

What is accepted in exchange. The gate now governs a strictly smaller set of sessions than the previous draft claimed, because rewriting needs an already-open permission boundary. It governs shell work, not the roughly 600 MB each `claude.exe` holds for its own context. A model can rephrase past a `deny`; this is backpressure, not a sandbox. Every tool call pays a process spawn, which is why the classifier must be trivial. And the fast path is only free for the admission half — the repeat detector records something per call.

The honest summary of the cost half: the per-event numbers are computable from published rates and the TTL is now measured rather than assumed; how often those events occur is still unmeasured. This ADR asserts the mechanism and the unit cost, and does not assert the total.

## Consequences

The hook entry lands in the worktree's own `.claude/settings.local.json` — untracked (`.gitignore` carries `**/.claude/settings.local.json*`), so it configures the developer's checkout without committing a hook into everyone else's. `haven setup gate-hook` writes it; nothing else does. Hooks are read at session start, so the installer affects future sessions only.

Narrowing reaches only auto-approving sessions. Under `default` permission mode the gate is an observer that can refuse but not rewrite, and the specs say so rather than implying uniform reach.

`haven doctor` gains admission counters shared with ADR-090.

The rewrap has to carry the caller's identity to `haven run`, since that is what decides the wait ceiling — and **it must not be spelled `--agent`.** That flag already exists across the haven CLI meaning "produce plain, token-free output", and ADR-064's second rule is one meaning per flag everywhere. A new spelling is needed for "this run belongs to a sub-agent, so give it the five-minute ceiling". `haven run` and `haven gate` are themselves free: neither name is taken by the current surface.

Two contract questions remain open and are marked in the specs rather than assumed: whether `/model` raises any hook at all, and where `CLAUDE.md` sits in the cached prefix. The highest-variance unknown is still the 20-block lookback window — a turn producing more content blocks than a breakpoint can walk back over causes a silent miss on every subsequent request, which would be continuous rather than per-event cost. It remains a measurement.

## References

- [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature) — what the gate admits into, and the once-only handoff
- [specs/claude/telemetry-turn-bounding.feature](../../../specs/claude/telemetry-turn-bounding.feature) — adjacent but not the same thing: that spec governs how LangWatch *ingests* Claude Code logs (and describes a mechanism ADR-055 retired, preserved for porting). This ADR is about what Claude Code *exports* and what a hook observes locally. Neither constrains the other; the pairing is named so the overlap in title is not mistaken for overlap in scope.
- Measured against a headless session with a scratch settings file: the matcher shape above fires; `updatedInput` applies with `allow` and not with `defer`; the payload carries no `agent_id` in a main session; a compiled Go panic exits 2
- Measured across 40 real transcripts (14,121 cache-writing requests, ~53M cache-write tokens): sub-agents write `ephemeral_5m` 100% of the time, main sessions write `ephemeral_1h` 100% of the time, no request writes both
- Published rates: cache read 0.1× base input, write 1.25× (5m TTL) / 2× (1h); minimum cacheable prefix 512 tokens on Opus 5; breakpoints walk back at most 20 content blocks; an entry is readable only once the first response using it begins streaming
