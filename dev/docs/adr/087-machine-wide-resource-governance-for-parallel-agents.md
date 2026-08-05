# ADR-087: A developer laptop running many agents needs one governor, not many limits

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-064](./064-haven-cli-redesign.md) (the haven CLI and daemon this extends), [ADR-069](./069-payload-cost-doctrine.md) (the same "bound the cost at the seam that knows the cost" reasoning, applied to a queue rather than a laptop).

**Behavioural contract:** [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature), [specs/setup/memory-pressure-governor.feature](../../../specs/setup/memory-pressure-governor.feature).

## Context

A laptop driving one worktree is fine. The working state now is several worktrees under `.claude/worktrees/`, each with its own haven stack, and around ten agents editing and testing in parallel. That machine is unusable for minutes at a time, and it is worth being precise about why, because the obvious answer is wrong.

A measurement from an 11-core, 18 GiB machine mid-session: 17 `node` processes, each 24 threads, each 550–712 MB, PIDs clustered inside a 250-PID range — one simultaneous burst totalling about 10.5 GB. Alongside them a `limactl` VM at 8 GB, `biome` at 1 GB, `gopls` at 742 MB. Swap was 3.2 GB of 4 GB used and the compressor occupied about 2 GiB (128k pages at the 16 KiB page size Apple silicon uses).

Those 17 processes are vitest workers under `pool: "vmForks"`, which `platform/app/vitest.config.ts` picks deliberately and whose comment records the reason: 128 MB per vmThreads worker against 573 MB per vmFork, traded for roughly 15% less wall clock. That measured 573 MB is what the observed 550–712 MB range is. The repo's guardrail is `maxWorkers: "50%"`, which on 11 cores is 5 workers **per run**. Three or four agents running `pnpm test:unit` at the same moment is 15–20 workers. The guardrail is per-run and there is no machine-wide one, so it does exactly what it says and the machine still dies.

`dev/scripts/check-queue.mjs` (PR #6598, open and unmerged) already fixed this shape for `typecheck`, `lint` and `format`: one counter shared by every worktree, terminal and agent. That is the right mechanism. Two gaps remain.

**Tests are not on it.** The counter covers the checks, which are the smaller problem. The 10.5 GB burst above is uncounted.

**The limit is static and partly blind.** It derives from `os.totalmem()` and core count — one slot per 6 GiB, capped at one per 4 cores. On this machine 18 GiB gives 3 and 11 cores gives 2, so the core cap decides and the answer is 2. But 8 GiB of that RAM is inside a colima VM the process cannot use, so the memory term is computed against a number that overstates what is available; on the ~10 GiB actually free it would have given 1.

### What measurement changed

The first two drafts of this ADR had a third gap, and it was the load-bearing one: that a queued run parks an agent past the prompt cache's idle expiry, so waiting costs more than the RAM it saves. **That premise was wrong, and a probe settled it.** A headless Claude Code run reports its cache writes as `ephemeral_1h_input_tokens`, with `ephemeral_5m_input_tokens` at zero — Claude Code takes the **one-hour** cache TTL, not the five-minute default.

Three consequences, and they reshape the decision rather than decorate it.

The idle floor is roughly an hour, so **#6598's existing 30-minute failsafe already sits inside it**. The urgent problem the earlier drafts were solving mostly does not exist at this TTL.

The bust is nearly twice as expensive as those drafts said. On the one-hour TTL a cache write costs 2× base input against a read's 0.1×, so re-caching a prefix you were about to read costs a **1.9× premium**, not 1.15×. On a 300k-token prefix at Opus 5's input rate that is about $2.85 rather than $1.73.

And the five-minute floor is still real, just not the default: a session in usage overage drops back to the five-minute TTL. So the constraint is regime-dependent rather than absent — which means it has to be *detected*, not assumed. It is detectable: the per-message usage in a session's transcript reports which of the two lifetimes the write went to.

One correction while being precise about premises. Earlier drafts said macOS offers no way to bound a process's memory. It does: `taskpolicy -m <MiB>` sets a jetsam memory limit at spawn, and `-j` sets a jetsam priority. That is rejected below, but on its merits rather than on a false claim of impossibility.

Two further structural notes. `taskpolicy -b` moves a process into the throttled background band and `-B` moves it back out; `-p` applies both to an already-running process, but the man page's inheritance guarantee covers children of a program *launched* under the policy, not a tree that is already running — so demotion has to walk the process group rather than signal the launcher and assume. And summed RSS is not the pressure signal: `GroupRSS`'s `ps` summation double-counts shared pages and overstates by several GB. The honest signals are the compressor's occupied pages and swap usage.

## Decision

**One counter covers every heavy run on the machine, and tests join it.** `check-queue.mjs` already is that counter; `test:unit` and `test:integration` route through it alongside `typecheck`, `lint` and `format`. They compete for the same cores and RAM, so they contend for the same slots.

**Queueing is the primary lever.** A run that finds no slot waits. This is the plain reading of #6598 extended to tests, and at the one-hour TTL it is also the cheapest: a queued run holds no RAM at all, where a narrowed one holds some, and the wait is nearly free because the cache survives it. The earlier drafts inverted this on a premise that measurement did not support.

**Narrowing is a fallback for the five-minute regime only.** When a session's recent cache writes went to the five-minute TTL — readable from the transcript — a long wait does cost a cold re-read, and a run projected to finish inside that shorter floor is narrowed and started rather than queued. Outside that regime, and for any run whose duration haven has not observed, the answer is to queue. Narrowing is deliberately the exception: CLAUDE.md's own guidance is that reaching for a smaller worker count "serializes the run so it stays resident far longer, overlapping every other agent's run", and that is right whenever the wait it avoids was cheap.

**Narrowed runs still consume admission**, and their worker count divides by the runs actually in flight rather than by the configured limit. Otherwise ten agents each start narrowed, nothing bounds the total, and the original burst reappears at full spec compliance.

**A run is admitted exactly once, and the outer holder wins.** `haven run --class heavy` (new, arriving with [ADR-088](./088-haven-gate-agent-admission-and-cost-safety.md)) holds a slot and exports a marker; `check-queue.mjs` sees it and stands down for that run. This is the rule #6598 already uses for `haven typecheck`, which passes `CHECK_SLOTS=0` for exactly this reason. Without it a rewrapped test run takes an outer slot and then waits for an inner one, and at a limit of 1 it waits for itself.

**One precedence table decides admission, and every scenario maps to a row of it.**

| Pressure | Slot free | Session on the 5-minute TTL, and run fits inside it | Outcome |
|---|---|---|---|
| green / amber | yes | — | admit unchanged |
| green / amber | no | no (the common case) | queue |
| green / amber | no | yes | narrow, admit, consume a slot |
| red | yes | — | admit unchanged |
| red | no | — | refuse, with a reason |

Red is the only level that refuses. Amber's job is to demote and to stop admitting at full width; it does not refuse work.

**The wait ceiling follows the observed TTL rather than a constant.** On the one-hour TTL the existing 30-minute failsafe stands unchanged for every caller. Only a session detected on the five-minute TTL gets a tightened ceiling, and only for agent-driven runs — a human waiting at a terminal is not an idle API session either way.

**The daemon publishes pressure; the callers read it.** The daemon already ticks every 10s. It samples the machine — compressor occupancy and swap — classifies it, and writes that to its state directory.

**Fail-open is scoped to the pressure-derived behaviour only.** A missing, stale or unparseable pressure file reads as green, which disables narrowing and red's refusal. It does **not** disable slot counting: #6598's queue never depended on a pressure file, and a developer running plain `pnpm` without the daemon must keep exactly the protection they have today.

**Under pressure the daemon demotes rather than kills.** Amber demotes every stack except the focused worktree into the background band, walking the process group so already-running children are covered, and `taskpolicy -B` restores them when pressure clears. Red additionally names the largest stack and the command to stop it — it does not stop it. Focus is the worktree of the most recently active stack; when focus cannot be determined, nothing is demoted.

**The daemon extends the orphan sweep that already exists.** `procsupervisor.reapOrphans` already reclaims dev-runtime processes whose parent is PID 1 in known directories at every `haven up`. The same rule runs on the tick and covers test workers.

**Drift the daemon cannot fix, it reports.** `Runtime.Ensure` applies colima limits only when haven creates the profile, so an oversized VM is invisible to haven forever. `haven doctor` reports the drift and prints the commands to reconcile it.

## Rationale / Trade-offs

**A jetsam memory limit is available and is still the wrong tool.** `taskpolicy -m` would give a per-stack ceiling at spawn — closer to a cgroup than the earlier drafts admitted. It is rejected because jetsam *kills* the process that breaches its limit. That converts a slow machine into lost work, which is the outcome this whole ADR is arranged to avoid, and `RunOnceBounded` already covers the genuinely runaway case with an RSS and duration ceiling. What was missing was admission, not a harder kill. The `-m` option is worth knowing about because a future decision might want it for a stack whose death is cheap; it is not worth using here.

**The narrowing argument had to survive a measurement, and mostly did not.** Two reviews attacked it on the grounds that a *running* tool call issues no API requests either, so a narrowed run that outlives the floor loses the cache exactly as a park does. That was correct. The probe then showed the floor is an hour rather than five minutes, which removes most of the remaining motive. What is left is a genuine but narrow case — a session in overage, with a run short enough to fit — and narrowing is scoped to exactly that. Recording this is the point: the first draft's central lever is the third draft's edge case, and the reason is that nobody had measured the TTL.

What is accepted in exchange. Detecting the TTL regime means reading a session's transcript, which is an approximation and a coupling to a file format we do not own; when it cannot be read the answer is "assume the long TTL", which errs toward queueing and is safe. The pressure signal is a heuristic with thresholds picked from observed behaviour; fail-open means it errs toward doing nothing. Demotion is macOS-only.

The 8 GiB VM is the honest illustration of the residual gap: after all of this, the largest single consumer on the machine is still outside haven's control, and the answer is a printed hint.

## Consequences

`pnpm test:unit` becomes a queued command, and in one narrow regime a narrowed one. The queue is silent when it does nothing, per #6598's contract, so the common case is unchanged.

The daemon gains a sampling responsibility on a tick it already runs, and a state file other processes read — needing a version field, a staleness threshold, and a documented reading for an unparseable one, all three resolving to green.

There is a second, reverse channel this ADR requires and does not yet specify: the doctor's counters describe things `check-queue.mjs` knows, and it is a transient process whose queue entries are deleted on release. Somewhere to append those events that haven reads is a real surface, named here so it is not discovered during implementation.

`haven doctor` gains lines for pressure, admission counts, and colima drift, plus the two metrics that say whether this is a net win: agent-driven parks that crossed the session's *actual* floor, and narrowed runs whose actual duration crossed it. Both are now expected to be near zero most of the time, because most sessions have an hour of headroom — which is itself the finding worth watching.

Nothing here touches CI. `CHECK_SLOTS` is already off under CI and a runner running one job needs no governor.

## References

- PR #6598 — the counter this extends. **Not yet merged**: it adds `dev/scripts/check-queue.mjs` and `specs/setup/check-slots.feature`, so this ADR is stacked on it and that spec link resolves only once it lands.
- [specs/setup/haven-resource-caps.feature](../../../specs/setup/haven-resource-caps.feature) — the per-service caps this sits above
- [ADR-088](./088-haven-gate-agent-admission-and-cost-safety.md) — the hook that lets an agent's tool call reach this governor
- `platform/app/vitest.config.ts` — the `vmForks` choice and the 573 MB/fork measurement this ADR's arithmetic rests on
- Measured, not assumed: Claude Code writes `ephemeral_1h` cache entries; a compiled Go panic exits 2; `taskpolicy` supports `-B` (un-demote), `-p` (running process), and `-m` (spawn-time jetsam memory limit)
