# ADR-088: haven answers the agent's tool call; it never drives the agent

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-087](./087-machine-wide-resource-governance-for-parallel-agents.md) (the governor this is the entry point to), [ADR-064](./064-haven-cli-redesign.md) (the CLI surface `haven gate` and `haven run` join).

**Behavioural contract:** [specs/claude/agent-admission-gate.feature](../../../specs/claude/agent-admission-gate.feature), [specs/claude/llm-cost-safety.feature](../../../specs/claude/llm-cost-safety.feature).

## Context

ADR-087 gives the machine a governor. The governor is useless if nothing consults it, and the things that need to consult it are ten Claude Code sessions that cannot see each other, were not started by haven, and must not be started by haven.

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

**`haven gate` is a hook, registered at the user level so it covers every session on the machine.** It reads one JSON payload on stdin, answers, exits. It has two duties sharing one seam: machine admission (ADR-087) and prompt-cost safety.

**It registers for more than `PreToolUse`, and the Decision names them.** Admission and command-shaped cost checks are `PreToolUse`. Settings and instruction changes that arrive without a tool call are `ConfigChange` and `InstructionsLoaded`. Turn-shaped observations are `PostToolBatch` and `Stop`. Sub-agent accounting is `SubagentStart` and `SubagentStop`. A check with no event that can observe it is not specced.

**It classifies narrowly and defers by default** — vitest, tsgo, biome, `next build`, `go build`, `docker build` are heavy; everything else returns `defer` after reading one cached file.

**It rewraps only where the permission boundary is already open.** Rewriting requires `allow`, and `allow` bypasses the permission system, so returning it for an arbitrary command would auto-approve — whenever the machine happened to be busy — something the user's rules would have prompted about. The gate therefore rewraps only when `permission_mode` already indicates auto-approval (`bypassPermissions`, `acceptEdits`, `auto`, `dontAsk`). Under `default` or `plan` it leaves the command untouched and falls back to observing and, at red, denying. This is a real reduction in reach, and it lands where it should: unattended fleets run in an auto-approving mode and are the case this ADR exists for, while an interactive session keeps its permission prompts and gets a warning instead of a rewrite.

**The rewrap passes the command as one escaped argument.** `tool_input.command` is a shell string, not argv, so splicing it after a `--` separator would leave everything past an `&&` outside the slot. It becomes `haven run --class heavy --sh '<escaped original>'`, addressed by haven's own absolute path because `make haven install` is optional and a rewrite that yields `command not found` has broken a working command in the name of fail-open. A command already wrapped is not wrapped again, or the outer holds the slot the inner waits for.

**A rewrapped command is admitted exactly once.** `haven run` exports a marker that `check-queue.mjs` honours by standing down, mirroring the `CHECK_SLOTS=0` rule #6598 already uses for `haven typecheck`.

**The rewrap announces itself.** Because the model can see the substitution and will distrust it, the replacement carries a description saying haven queued the command and why. An unexplained rewrite makes an agent doubt its own environment, which is a worse failure than a slow test run.

**Never exit 2, and never let the runtime choose the exit code.** The gate recovers panics in main, runs no goroutines on the decision path, and translates any abnormal termination into a deferring exit. Stated as a decision because the language default is the failure mode.

**Refusal is a machine-health lever first, and a cache lever only for sub-agents.** A main session keeps its cache through any wait the existing 30-minute failsafe permits, so against that caller the earlier draft's "denying is cheaper than parking" does not hold at all. Against a sub-agent it does, because five minutes is a wait the queue can genuinely exceed. Red refuses either way, because at red the machine cannot take the work regardless of who is asking. A deny is not free — it costs a turn — so the same command is not denied indefinitely.

**On the cost side the gate warns, and each check names its channel.** No primitive shows the model a price and still lets the action proceed — `systemMessage` reaches the developer and not the model, `ask` interrupts the developer, `deny` reaches the model but blocks. Warnings are therefore for the developer. High-certainty, high-value invalidations on a large prefix use `ask`; everything else uses `systemMessage`. Two things get `deny`: a tool call repeating identically with no intervening change, and a sub-agent spawn past the machine-wide cap.

**The repeat detector is scoped so it cannot break the red-green loop** — consecutive identical calls, no intervening file edit and no intervening different tool call, counted per session and reset on either.

**The spawn cap is allowed to lose count, and fails open when it does.** `SubagentStop` and `SessionEnd` provide the decrement, but `PreToolUse` fires before the permission check, so a rejected spawn is counted and never runs and drift is one-directional. Entries expire, and an unverifiable count admits — a stale-high counter refusing every spawn on the machine forever is the fail-closed outcome this ADR calls non-negotiable.

**Measurement precedes enforcement, and the measurement is not yet confirmed.** The repo's `.claude/settings.json` sets `OTEL_*` exporters and an endpoint, but no `CLAUDE_CODE_ENABLE_TELEMETRY` and no exporter auth, and the user-level settings set no OTEL keys at all — so whether any of this reaches LangWatch today is unconfirmed. Confirming that export and reading the cache-read to cache-creation ratio is the first deliverable; that ratio decides which cost checks are worth building.

## Rationale / Trade-offs

The alternative to a hook was an MCP server exposing the same decisions as tools. Rejected because it inverts the direction: an MCP tool is called when the model chooses to, so it governs only cooperative agents, and the runaway session that most needs governing is the one that stops asking.

The alternative to rewrapping was a lease keyed by `tool_use_id`, released on `PostToolUse` — workable, but needing a TTL, a reaper for sessions that die between the two events, and a second source of truth. Rewrapping needs none of that because the OS drops a flock when its holder dies. That argument survives for the Bash case. It does **not** extend to the spawn cap, where an Agent call has no process to hold a lock on, so that leg re-imports the bookkeeping this paragraph avoids elsewhere, bounded by expiry rather than eliminated.

What is accepted in exchange. The gate now governs a strictly smaller set of sessions than the previous draft claimed, because rewriting needs an already-open permission boundary. It governs shell work, not the roughly 600 MB each `claude.exe` holds for its own context. A model can rephrase past a `deny`; this is backpressure, not a sandbox. Every tool call pays a process spawn, which is why the classifier must be trivial. And the fast path is only free for the admission half — the repeat detector records something per call.

The honest summary of the cost half: the per-event numbers are computable from published rates and the TTL is now measured rather than assumed; how often those events occur is still unmeasured. This ADR asserts the mechanism and the unit cost, and does not assert the total.

## Consequences

A hook entry appears in the user-level `.claude/settings.json`, outside the repo, so this ships as documented configuration plus a `haven` subcommand that installs it. Hooks are read at session start, so the installer affects future sessions only.

Narrowing reaches only auto-approving sessions. Under `default` permission mode the gate is an observer that can refuse but not rewrite, and the specs say so rather than implying uniform reach.

`haven doctor` gains admission counters shared with ADR-087.

Two contract questions remain open and are marked in the specs rather than assumed: whether `/model` raises any hook at all, and where `CLAUDE.md` sits in the cached prefix. The highest-variance unknown is still the 20-block lookback window — a turn producing more content blocks than a breakpoint can walk back over causes a silent miss on every subsequent request, which would be continuous rather than per-event cost. It remains a measurement.

## References

- [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature) — what the gate admits into, and the once-only handoff
- [specs/claude/telemetry-turn-bounding.feature](../../../specs/claude/telemetry-turn-bounding.feature) — the existing Claude-side telemetry contract
- Measured against a headless session with a scratch settings file: the matcher shape above fires; `updatedInput` applies with `allow` and not with `defer`; the payload carries no `agent_id` in a main session; a compiled Go panic exits 2
- Measured across 40 real transcripts (14,121 cache-writing requests, ~53M cache-write tokens): sub-agents write `ephemeral_5m` 100% of the time, main sessions write `ephemeral_1h` 100% of the time, no request writes both
- Published rates: cache read 0.1× base input, write 1.25× (5m TTL) / 2× (1h); minimum cacheable prefix 512 tokens on Opus 5; breakpoints walk back at most 20 content blocks; an entry is readable only once the first response using it begins streaming
