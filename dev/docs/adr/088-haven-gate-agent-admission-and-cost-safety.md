# ADR-088: haven answers the agent's tool call; it never drives the agent

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-087](./087-machine-wide-resource-governance-for-parallel-agents.md) (the governor this is the entry point to), [ADR-064](./064-haven-cli-redesign.md) (the CLI surface `haven gate` joins).

**Behavioural contract:** [specs/claude/agent-admission-gate.feature](../../../specs/claude/agent-admission-gate.feature), [specs/claude/llm-cost-safety.feature](../../../specs/claude/llm-cost-safety.feature).

## Context

ADR-087 gives the machine a governor. The governor is useless if nothing consults it, and the things that need to consult it are ten Claude Code sessions that cannot see each other, were not started by haven, and must not be started by haven.

Claude Code's hook surface is the seam. A `PreToolUse` hook runs before every tool call, including inside sub-agents, and the direction of control is the one we want: the agent calls haven, haven answers, haven never invokes the agent. Three properties of the contract make it usable rather than merely present.

It receives the full `tool_input`, and may return **`updatedInput`** to replace it. So the gate is not restricted to allow-or-deny; it can rewrite a command before it runs. That is what makes ADR-087's "narrow rather than queue" reachable from here.

It carries **`agent_id`** and `agent_type` when firing inside a sub-agent. Ten sub-agents are individually identifiable, so a fair share is expressible instead of one agent taking four slots.

It **fails open**. A hook that times out, crashes, or exits non-zero (other than 2) lets the command proceed. For a resource governor that is the correct default and it is not negotiable: a broken haven must never wedge the agents it governs.

The second thing the gate is well placed to do has nothing to do with RAM. Prompt caching is a prefix match — any byte change in the prefix invalidates everything after it — and the economics are asymmetric in a way that is easy to trip and impossible to see. A cache read costs 0.1× base input; a cache write costs 1.25× (5-minute TTL) or 2× (1-hour). Invalidating a prefix you were about to read therefore costs the difference: **1.15× base input per token re-cached, or 1.9× on the hour TTL**. On a 300k-token session prefix at Opus 5's rates that is roughly $1.73 or $2.85, per bust, per agent. The actions that cause it are small and routine — editing an instructions file, toggling an MCP server, switching model mid-session — and none of them announce their cost.

The same hook sees those actions before they happen.

## Decision

**`haven gate` is a `PreToolUse` hook, registered once at the user level, covering every session and sub-agent on the machine.** It reads one JSON payload on stdin, answers, and exits. It has two duties, and they are separate concerns sharing one seam rather than one concern: machine admission (ADR-087) and prompt-cost safety.

**It classifies narrowly and defers by default.** Only a small set of commands are heavy — vitest, tsgo, biome, `next build`, `go build`, `docker build`. Everything else returns `defer` in a few milliseconds. A gate on `ls` would be its own outage, so the fast path does nothing but read a cached pressure file and return.

**It rewraps rather than blocks.** The hook exits before the command runs, so it cannot hold a slot for the command's lifetime. Rather than fix that with leases and TTLs, the gate rewrites the command to run under `haven run --class heavy -- <original>`. haven's own process then holds the flock for exactly as long as the work lives — the property `adapters/semaphore` already documents — and the existing `RunOnceBounded` reaper applies unchanged. The hook itself never waits.

**Denying is the gentle option, not the harsh one.** This inverts the intuition and follows directly from ADR-087's cache constraint. A deny costs one small turn with the cache warm. A six-minute park costs a cold re-read of the entire conversation. So under red pressure the gate refuses immediately with a reason the model can act on, rather than admitting the run into a queue it will sit in.

**A deny must never invite a sleep.** "Try again in a few minutes" is a request a model can satisfy with `sleep 180`, which is the failure mode restated. The refusal text says explicitly not to sleep or poll, and names work that is safe to do instead. This is a copy requirement, pinned by a scenario, not a stylistic preference.

**On the cost side the gate warns; it does not decide.** A cache-busting edit is usually a thing the developer meant to do. The gate's job is to make the price visible at the moment of the action — how large the cached prefix is and what invalidating it costs — not to prevent it. Two exceptions get a hard `deny`, because both are unambiguous waste with no legitimate reading: a tool call repeating identically past a threshold (a stuck loop), and a sub-agent spawn past the machine-wide concurrency cap.

**Certainty is ranked, and the gate says which kind it is holding.** That a model switch or a tool-list change invalidates everything is documented behaviour. That editing `CLAUDE.md` mid-session does depends on where the harness places it in the prefix, which is an implementation detail we have not verified. High-certainty checks warn plainly; the rest are held behind the measurement below and marked as such, because a warning that is wrong twice is a warning nobody reads a third time.

**Measurement precedes enforcement.** `.claude/settings.json` already exports Claude Code OTel with token detail to LangWatch, and Claude Code emits token metrics split by `cache_read` and `cache_creation`. The ratio of the two per session is therefore already in our own product. That ratio decides which of these checks are worth having: if cache-read dominates, most of the cost half of this ADR is theoretical. The first deliverable is the dashboard, not the hook.

## Rationale / Trade-offs

The alternative to the hook was an MCP server exposing the same decisions as tools. It was rejected because it inverts the direction we need — an MCP tool is called when the model chooses to call it, so it governs only agents that cooperate, and precisely the runaway session that most needs governing is the one that stops asking. A `PreToolUse` hook is not optional from the model's side.

The alternative to rewrapping was a lease keyed by `tool_use_id`, released on `PostToolUse`. It works, and it needs a TTL, a reaper for sessions that die between the two events, and a second source of truth about what is running. Rewrapping needs none of that because the OS already drops a flock when its holder dies.

What is accepted in exchange. The gate governs shell work, which is where the RAM goes, but it cannot touch the ~600 MB each `claude.exe` holds for its own context — several of those are visible in the same measurement that motivated ADR-087, and this ADR does nothing about them. A model can also rephrase its way past a `deny`; this is backpressure, not a sandbox, and the hard ceiling remains the reaper. Every tool call now pays a process spawn, which is small but not free, and is the reason the classifier has to be trivial rather than clever.

The honest summary of the cost half: the per-event numbers are computable from published rates, but how often those events happen is unmeasured. This ADR asserts the mechanism and the unit cost, and explicitly does not assert the total.

## Consequences

A hook entry appears in the user-level `.claude/settings.json`. That file is outside the repo, so this ADR ships the entry as documented configuration plus a `haven` subcommand that installs it, rather than as a checked-in file. The exact matcher syntax is the one thing here that needs a smoke test before it is documented as working — no installed plugin in this setup uses hooks, so it could not be verified by reading one.

`haven gate` must stay fast and must never fail closed. Both are testable: a scenario pins that a malformed payload, an unreadable state directory, and an internal panic all produce `defer`.

`haven doctor` gains admission counters, including the number of parks that crossed the cache floor — the same metric ADR-087 relies on to know whether it is a net win.

Three things are deliberately left unverified and marked in the specs rather than asserted: whether `/model` fires any hook at all, where `CLAUDE.md` sits in the cached prefix, and whether Claude Code's own breakpoint placement ever trips the 20-block lookback window. The third is the highest-variance unknown in this ADR — if it does trip, the cost is continuous rather than per-event and dwarfs everything else here; if it does not, that check is worth nothing. It is a measurement, not an assumption, and the spec says so.

## References

- [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature) — what the gate admits into
- [specs/claude/telemetry-turn-bounding.feature](../../../specs/claude/telemetry-turn-bounding.feature) — the existing Claude-side telemetry contract
- Anthropic prompt-caching economics: cache read 0.1× base input, cache write 1.25× (5m TTL) / 2× (1h); minimum cacheable prefix 512 tokens on Opus 5; breakpoints walk back at most 20 content blocks
