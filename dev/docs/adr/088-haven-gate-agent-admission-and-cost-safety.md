# ADR-088: haven answers the agent's tool call; it never drives the agent

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-087](./087-machine-wide-resource-governance-for-parallel-agents.md) (the governor this is the entry point to), [ADR-064](./064-haven-cli-redesign.md) (the CLI surface `haven gate` and `haven run` join).

**Behavioural contract:** [specs/claude/agent-admission-gate.feature](../../../specs/claude/agent-admission-gate.feature), [specs/claude/llm-cost-safety.feature](../../../specs/claude/llm-cost-safety.feature).

## Context

ADR-087 gives the machine a governor. The governor is useless if nothing consults it, and the things that need to consult it are ten Claude Code sessions that cannot see each other, were not started by haven, and must not be started by haven.

Claude Code's hook surface is the seam. Hooks fire before tool calls, including inside sub-agents, and the direction of control is the one we want: the agent calls haven, haven answers, haven never invokes the agent. Four properties of the contract matter.

The `PreToolUse` payload carries the full `tool_input`, and the hook may return **`updatedInput`** to replace it. So the gate is not restricted to allow-or-deny; it can rewrite a command before it runs, which is what makes ADR-087's narrowing reachable from here.

It carries **`agent_id`** inside a sub-agent (and not in a main session), plus `session_id`, `permission_mode` and `transcript_path`.

It **fails open** — a hook that times out, or exits non-zero with any code other than 2, lets the command proceed. For a resource governor that is correct and non-negotiable.

And **exit code 2 is the one code that blocks**, using stderr as the reason. This is a trap rather than a feature: an unrecovered Go panic terminates a process with exit status 2. `haven gate` will be Go, like the rest of haven, so the language's own crash default is a machine-wide tool-call blocker — the exact inverse of the property above.

The second thing the gate is placed to do has nothing to do with RAM. Prompt caching is a prefix match, and the economics are asymmetric in a way that is easy to trip and impossible to see. A cache read costs 0.1× base input; a cache write costs 1.25× (5-minute TTL) or 2× (1-hour). Invalidating a prefix you were about to read therefore costs the difference: **1.15× base input per token re-cached, or 1.9× on the hour TTL**. On a 300k-token prefix at Opus 5's rates that is roughly $1.73 or $2.85, per bust, per agent. The actions that cause it — editing an instructions file, toggling an MCP server, switching model mid-session — are small, routine, and silent.

There is a related cost the spawn cap turns out to price better than RAM does: a cache entry is only readable once the first response using it begins streaming, so N sub-agents launched in one turn all share a prefix and all pay the write, not the read.

## Decision

**`haven gate` is a hook, registered at the user level so it covers every session on the machine.** It reads one JSON payload on stdin, answers, exits. It has two duties sharing one seam: machine admission (ADR-087) and prompt-cost safety.

**It registers for more than `PreToolUse`, and the Decision names them**, because several checks below observe things `PreToolUse` cannot see. Admission and the command-shaped cost checks are `PreToolUse`. Settings and instruction changes that arrive without a tool call are `ConfigChange` and `InstructionsLoaded`. Turn-shaped observations are `PostToolBatch` and `Stop`. Sub-agent accounting is `SubagentStart` and `SubagentStop`. A check with no event that can observe it is not specced.

**It classifies narrowly and defers by default.** Only a small set of commands are heavy: vitest, tsgo, biome, `next build`, `go build`, `docker build`. Everything else returns `defer` after reading one cached file.

**It rewraps rather than blocks, and it rewraps the shell string as a whole.** The hook exits before the command runs, so it cannot hold a slot for the command's lifetime; rewriting the command so haven's own process holds the flock avoids a lease, a TTL and a reaper. But `tool_input.command` is a **shell string, not argv** — splicing it after a `--` separator breaks on every operator, and `pnpm test:unit x && echo done` would gate only the first segment while the rest ran outside the slot. So the rewrap passes the original as a single escaped argument to `haven run --class heavy --sh '<original>'`, and haven execs it through a shell. The gate rewraps to haven's own absolute path, because `make haven install` is optional and a rewrite that yields `command not found` has broken a working command in the name of fail-open.

**A rewrapped command is admitted exactly once.** `haven run` exports a marker that `check-queue.mjs` honours by standing down, mirroring the `CHECK_SLOTS=0` rule #6598 already uses for `haven typecheck`. Without it the outer run holds the slot the inner one waits for. The gate also refuses to rewrap a command that is already wrapped, or a nested wrap deadlocks the same way.

**The gate never widens the permission boundary.** `allow` bypasses the permission system, so returning it for a rewrapped command would auto-approve, whenever the machine happens to be busy, a command the user's own rules would have prompted about. The gate therefore returns `defer` with the rewritten input, leaving the normal permission flow to evaluate it. **Whether `updatedInput` is honoured alongside `defer` is unverified**, and is the second item in the same smoke test as the matcher syntax. If it is not, the fallback is to rewrap only when `permission_mode` already indicates auto-approval, and otherwise leave the command untouched — losing the narrowing rather than gaining an approval.

**Refusal beats parking only for short runs, and the ADR says so rather than claiming it generally.** A deny costs one small turn with the cache warm; a park past the floor costs a cold re-read. But a *running* command issues no API requests either, so a run whose own duration exceeds the floor loses its cache regardless and the deny's benefit is purely machine health. The claim is conditioned on projected runtime, exactly as ADR-087's narrowing is. A deny is also not free — on a 300k prefix a deny-and-retry turn costs cache-read plus output, so a dozen cycles approach the price of the bust being avoided, and the gate does not re-deny the same command indefinitely.

**Never exit 2, and never let the runtime choose the exit code.** The gate recovers panics in main, runs no goroutines on the decision path, and translates any abnormal termination into a deferring exit. This is stated as a decision rather than left to implementation because the language default is the failure mode.

**On the cost side the gate warns, and each check names its channel.** There is no primitive that shows the model a price and still lets the action proceed: `systemMessage` reaches the developer and not the model, `ask` interrupts the developer, `deny` reaches the model but blocks. So warnings are for the developer. High-certainty, high-value invalidations on a large prefix use `ask`, because they are worth one interruption. Everything else uses `systemMessage`. Two things get `deny`: a tool call repeating identically with no intervening change, and a sub-agent spawn past the machine-wide cap.

**The repeat detector is scoped so it cannot break the red-green loop.** Rerunning an identical test command after an edit is the most common sequence in this repo, and a naive detector denies it. The rule is *consecutive* identical calls with no intervening file edit and no intervening different tool call, counted per session and reset on either.

**The spawn cap is allowed to lose count, and fails open when it does.** Counting concurrent sub-agents needs a decrement, so `SubagentStop` and `SessionEnd` are registered; but `PreToolUse` fires before the permission check, so a rejected spawn is counted and never runs, and drift is one-directional. A stale-high counter would refuse every spawn on the machine forever, which is the fail-closed outcome this ADR calls non-negotiable. Entries therefore expire, and an unverifiable count admits.

**Certainty is ranked, and the gate says which kind it holds.** That a model switch or a tool-list change invalidates everything is documented. That editing `CLAUDE.md` mid-session does depends on where the harness places it in the prefix, which is not verified. Nor is it verified that `/model` raises any hook at all. Those checks carry their hedge into the spec rather than asserting through it.

**Measurement precedes enforcement, and the measurement is not yet confirmed.** The repo's `.claude/settings.json` sets `OTEL_*` exporters and an endpoint, and Claude Code emits token metrics split by `cache_read` and `cache_creation`. But it sets no `CLAUDE_CODE_ENABLE_TELEMETRY` and no exporter auth headers, and the user-level settings set no OTEL keys at all, so whether any of this reaches LangWatch today is unconfirmed. The first deliverable is confirming that export and reading the cache-read to cache-creation ratio; that ratio decides which cost checks are worth building. An earlier draft of this ADR asserted the data was already there, which was a guess in the section that exists to rank guesses.

## Rationale / Trade-offs

The alternative to a hook was an MCP server exposing the same decisions as tools. Rejected because it inverts the direction: an MCP tool is called when the model chooses to, so it governs only cooperative agents, and the runaway session that most needs governing is the one that stops asking.

The alternative to rewrapping was a lease keyed by `tool_use_id`, released on `PostToolUse`. It works and needs a TTL, a reaper for sessions that die between the two events, and a second source of truth. Rewrapping needs none of that because the OS drops a flock when its holder dies. That argument survives review for the Bash case and is the reason to keep it — but note the spawn cap above cannot use it, because an Agent call has no process to hold a lock on, so that one leg does re-import the bookkeeping this paragraph avoids elsewhere. It is bounded by expiry rather than eliminated.

What is accepted in exchange. The gate governs shell work, which is where the RAM goes, but does nothing about the roughly 600 MB each `claude.exe` holds for its own context — several are visible in the measurement that motivated ADR-087. A model can rephrase past a `deny`; this is backpressure, not a sandbox, and the reaper remains the hard ceiling. Every tool call pays a process spawn, which is why the classifier must be trivial. And the fast path is only free for the admission half: the repeat detector has to record something per call, so "no work beyond reading a cached file" holds for admission and not for cost.

The honest summary of the cost half: the per-event numbers are computable from published rates; how often those events occur is unmeasured. This ADR asserts the mechanism and the unit cost, and explicitly does not assert the total.

## Consequences

A hook entry appears in the user-level `.claude/settings.json`, outside the repo, so this ships as documented configuration plus a `haven` subcommand that installs it. Hooks are read at session start, so the installer affects future sessions only.

Three contract details need one smoke test before any of this is documented as working: the settings matcher syntax, whether `updatedInput` is honoured with `defer`, and whether `/model` raises a hook. All three are cheap to check and none could be verified by reading an installed plugin, because none of the installed plugins here use hooks.

`haven doctor` gains admission counters shared with ADR-087, including the two cache-floor crossings that decide whether the mechanism pays for itself.

The highest-variance unknown remains the 20-block lookback window: a turn that produces more content blocks than a breakpoint can walk back over causes a silent cache miss on every subsequent request. If that is happening the cost is continuous rather than per-event and dwarfs everything else here; if the harness places its breakpoints correctly it is worth nothing. It is a measurement, and the spec treats it as one.

## References

- [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature) — what the gate admits into, and the once-only handoff
- [specs/claude/telemetry-turn-bounding.feature](../../../specs/claude/telemetry-turn-bounding.feature) — the existing Claude-side telemetry contract
- Anthropic prompt-caching economics: cache read 0.1× base input, cache write 1.25× (5m TTL) / 2× (1h); minimum cacheable prefix 512 tokens on Opus 5; breakpoints walk back at most 20 content blocks; a cache entry is readable only once the first response using it begins streaming
