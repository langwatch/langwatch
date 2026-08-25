# ADR-090: A developer laptop running many agents needs one governor, not many limits

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-064](./064-haven-cli-redesign.md) (the haven CLI and daemon this extends), [ADR-069](../../../packages/group-queue/adrs/069-payload-cost.md) (the same "bound the cost at the seam that knows the cost" reasoning, applied to a queue rather than a laptop).

**Behavioural contract:** [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature), [specs/setup/memory-pressure-governor.feature](../../../specs/setup/memory-pressure-governor.feature).

## Context

A laptop driving one worktree is fine. The working state now is several worktrees under `.claude/worktrees/`, each with its own haven stack, and around ten agents editing and testing in parallel. That machine is unusable for minutes at a time, and it is worth being precise about why, because the obvious answer is wrong.

A measurement from an 11-core, 18 GiB machine mid-session: 17 `node` processes, each 24 threads, each 550–712 MB, PIDs clustered inside a 250-PID range — one simultaneous burst totalling about 10.5 GB. Alongside them a `limactl` VM at 8 GB, `biome` at 1 GB, `gopls` at 742 MB. Swap was 3.2 GB of 4 GB used and the compressor occupied about 2 GiB (128k pages at the 16 KiB page size Apple silicon uses).

Those 17 processes are vitest workers under `pool: "vmForks"`, which `platform/app/vitest.config.ts` picks deliberately and whose comment records the reason: 128 MB per vmThreads worker against 573 MB per vmFork, traded for roughly 15% less wall clock. That measured 573 MB is what the observed 550–712 MB range is. The repo's guardrail is `maxWorkers: "50%"`, which on 11 cores is 5 workers **per run**. Three or four agents running `pnpm test:unit` at the same moment is 15–20 workers. The guardrail is per-run and there is no machine-wide one, so it does exactly what it says and the machine still dies.

`dev/scripts/check-queue.mjs` (PR #6598, open and unmerged) already fixed this shape for `typecheck`, `lint` and `format`: one counter shared by every worktree, terminal and agent. That is the right mechanism. Two gaps remain.

**Tests are not on it.** The counter covers the checks, which are the smaller problem. The 10.5 GB burst above is uncounted.

**The limit is static and partly blind.** It derives from `os.totalmem()` and core count — one slot per 6 GiB, capped at one per 4 cores. On this machine 18 GiB gives 3 and 11 cores gives 2, so the core cap decides and the answer is 2. But 8 GiB of that RAM is inside a colima VM the process cannot use, so the memory term is computed against a number that overstates what is available; on the ~10 GiB actually free it would have given 1.

### What measurement changed

The first drafts of this ADR had a third gap, and it was the load-bearing one: that a queued run parks an agent past the prompt cache's idle expiry, so waiting costs more than the RAM it saves. The premise was asserted, not measured, and measuring it produced a sharper answer than either "five minutes" or "an hour".

A scan of 40 real transcripts on this machine — 14,121 cache-writing requests, about 53M cache-write tokens — comes back **perfectly bimodal**:

| Population               | Requests | Cache-write tokens | TTL                  |
| ------------------------ | -------: | -----------------: | -------------------- |
| Sub-agent transcripts    |    5,960 |              28.3M | **100% five-minute** |
| Main-session transcripts |    8,161 |              25.4M | **100% one-hour**    |

Not one request wrote both lifetimes, so this is not a breakpoint split inside a request. **Claude Code gives a main session the one-hour cache and a sub-agent the five-minute cache.** (A single headless `claude -p` probe reports one-hour, which is consistent and is exactly how an earlier draft of this ADR reached the wrong general conclusion: `-p` is a main session.)

That reshapes the decision rather than decorating it, because **the population this ADR exists to govern is the sub-agents, and they are all on the five-minute floor.** Ten parallel agents chewing through a worktree are ten five-minute caches. The one-hour floor belongs to the one main session per worktree, where #6598's existing 30-minute failsafe already sits comfortably inside it.

The bust also differs by population, in the opposite direction to the floor. A five-minute write costs 1.25× base input against a read's 0.1× — a **1.15× premium**, about $1.73 on a 300k-token prefix at Opus 5's input rate. A one-hour write costs 2×, a **1.9× premium**, about $2.85. So sub-agents park cheaply per token but expire fast; main sessions park expensively per token but almost never expire.

The regime therefore does not need detecting by inference. The hook payload carries `agent_id` inside a sub-agent and omits it in a main session, so the caller's own identity says which floor applies. An earlier draft specced parsing a transcript to work this out; that is deleted.

One correction while being precise about premises. Earlier drafts said macOS offers no way to bound a process's memory. It does: `taskpolicy -m <MiB>` sets a jetsam memory limit at spawn, and `-j` sets a jetsam priority. That is rejected below, but on its merits rather than on a false claim of impossibility.

Two further structural notes. `taskpolicy -b` moves a process into the throttled background band and `-B` moves it back out; `-p` applies both to an already-running process, but the man page's inheritance guarantee covers children of a program _launched_ under the policy, not a tree that is already running — so demotion has to walk the process group rather than signal the launcher and assume. And summed RSS is not the pressure signal: `GroupRSS`'s `ps` summation double-counts shared pages and overstates by several GB. The honest signals are the compressor's occupied pages and swap usage.

## Decision

**One counter covers every heavy run on the machine, and tests join it.** `check-queue.mjs` already is that counter; `test:unit` and `test:integration` route through it alongside `typecheck`, `lint` and `format`. They compete for the same cores and RAM, so they contend for the same slots.

**Queueing is the default lever, and for a main session it is the only one.** A run that finds no slot waits. At the one-hour floor a wait is nearly free — the cache outlives anything the 30-minute failsafe permits — and queueing dominates narrowing for the machine anyway, because a queued run holds no RAM where a narrowed one holds some.

**Narrowing exists for sub-agents, because they are the population on the five-minute floor.** A sub-agent-driven run that finds no slot and is projected to finish inside five minutes is narrowed and started rather than queued: that is the one case where the wait would genuinely cost a cold re-read and narrowing avoids it. A sub-agent run projected to take longer than the floor is queued anyway, because its cache is lost by running and narrowing would buy nothing. So is any run whose duration haven has not observed.

This is also where CLAUDE.md's warning is answered rather than waved at. Its guidance is that reaching for a smaller worker count "serializes the run so it stays resident far longer, overlapping every other agent's run." That is correct, and it is why narrowing is confined to runs that fit inside a five-minute floor — the residency extension is bounded by construction, and everywhere else the ADR agrees with CLAUDE.md and queues.

**Narrowed runs still consume admission**, and their worker count divides by the runs actually in flight rather than by the configured limit. Otherwise ten agents each start narrowed, nothing bounds the total, and the original burst reappears at full spec compliance.

**A run is admitted exactly once, and the outer holder wins.** `haven run --class heavy` (new, arriving with [ADR-091](./091-haven-gate-agent-admission-and-cost-safety.md)) holds a slot and exports a marker; `check-queue.mjs` sees it and stands down for that run. This is the rule #6598 already uses for `haven typecheck`, which passes `CHECK_SLOTS=0` for exactly this reason. Without it a rewrapped test run takes an outer slot and then waits for an inner one, and at a limit of 1 it waits for itself.

**One precedence table decides admission, and every scenario maps to a row of it.**

| Pressure      | Slot free | Caller                   | Fits inside a 5-minute floor | Outcome                       |
| ------------- | --------- | ------------------------ | ---------------------------- | ----------------------------- |
| green / amber | yes       | any                      | —                            | admit unchanged               |
| green / amber | no        | main session or terminal | —                            | queue                         |
| green / amber | no        | sub-agent                | no / unknown                 | queue                         |
| green / amber | no        | sub-agent                | yes                          | narrow, admit, consume a slot |
| red           | yes       | any                      | —                            | admit unchanged               |
| red           | no        | any                      | —                            | refuse, with a reason         |

Red is the only level that refuses. Amber's job is to demote and to stop admitting at full width; it does not refuse work.

**The wait ceiling follows the caller, because the caller determines the floor.** A sub-agent gets a ceiling below five minutes. A main session and an interactive terminal keep the existing 30-minute failsafe, which sits inside their one-hour floor. The signal is `agent_id`: present means sub-agent, absent means main session. There is no third state to be conservative about — an absent `agent_id` is how a main session arrives, so a run haven cannot otherwise identify keeps the main-session ceiling.

**The daemon publishes pressure; the callers read it.** The daemon already ticks every 10s. It samples the machine — compressor occupancy and swap — classifies it, and writes that to its state directory.

**Fail-open is scoped to the pressure-derived behaviour only.** A missing, stale or unparseable pressure file reads as green, which disables narrowing and red's refusal. It does **not** disable slot counting: #6598's queue never depended on a pressure file, and a developer running plain `pnpm` without the daemon must keep exactly the protection they have today.

**Under pressure the daemon demotes rather than kills.** Amber demotes every stack except the focused worktree into the background band, walking the process group so already-running children are covered, and `taskpolicy -B` restores them when pressure clears. Red additionally names the largest stack and the command to stop it — it does not stop it. Focus is the worktree of the most recently active stack; when focus cannot be determined, nothing is demoted.

**The daemon extends the orphan sweep that already exists.** `procsupervisor.reapOrphans` already reclaims dev-runtime processes whose parent is PID 1 in known directories at every `haven up`. The same rule runs on the tick and covers test workers.

**Drift the daemon cannot fix, it reports.** `Runtime.Ensure` applies colima limits only when haven creates the profile, so an oversized VM is invisible to haven forever. `haven doctor` reports the drift and prints the commands to reconcile it.

## Rationale / Trade-offs

**A jetsam memory limit is available and is still the wrong tool.** `taskpolicy -m` would give a per-stack ceiling at spawn — closer to a cgroup than the earlier drafts admitted. It is rejected because jetsam _kills_ the process that breaches its limit. That converts a slow machine into lost work, which is the outcome this whole ADR is arranged to avoid, and `RunOnceBounded` already covers the genuinely runaway case with an RSS and duration ceiling. What was missing was admission, not a harder kill. The `-m` option is worth knowing about because a future decision might want it for a stack whose death is cheap; it is not worth using here.

**The narrowing argument was attacked twice and survived in a smaller, better-defined shape.** Two reviews pointed out that a _running_ tool call issues no API requests either, so a narrowed run that outlives the floor loses the cache exactly as a park does. That was correct, and it is why narrowing is now conditioned on the run fitting inside the floor rather than merely being narrower. A first probe then suggested the floor was an hour, which would have removed most of the motive — but that probe was a headless main session, and the transcript scan showed the floor is five minutes for precisely the population this ADR governs. So the lever came back, for sub-agents only, with the fit condition attached.

Recording the sequence is the point. The premise went from asserted, to attacked, to measured wrong, to measured right, and the design is different at each step. Nobody had looked at a transcript until the third revision, and the answer was sitting in 40 of them.

What is accepted in exchange. The main-session and sub-agent floors are read off `agent_id`, which is a Claude Code contract detail rather than a stable interface. If it stops being sent, every caller reads as a main session and keeps the 30-minute failsafe — so the sub-agents this exists for would be parked past a five-minute cache. Defaulting the other way is not the safer trade: it would hand every main session the tighter ceiling on the strength of a field that is empty by design, and the runs that queue would narrow and background with no reason to. The bimodal split is measured on one machine and could be version-specific, which is worth re-checking rather than treating as a law. The pressure signal is a heuristic; fail-open means it errs toward doing nothing. Demotion is macOS-only.

The 8 GiB VM is the honest illustration of the residual gap: after all of this, the largest single consumer on the machine is still outside haven's control, and the answer is a printed hint.

## Consequences

`pnpm test:unit` becomes a queued command, and in one narrow regime a narrowed one. The queue is silent when it does nothing, per #6598's contract, so the common case is unchanged.

The daemon gains a sampling responsibility on a tick it already runs, and a state file other processes read — needing a version field, a staleness threshold, and a documented reading for an unparseable one, all three resolving to green.

There is a second, reverse channel this ADR requires and does not yet specify: the doctor's counters describe things `check-queue.mjs` knows, and it is a transient process whose queue entries are deleted on release. Somewhere to append those events that haven reads is a real surface, named here so it is not discovered during implementation.

`haven doctor` gains lines for pressure, admission counts, and colima drift, plus the two metrics that say whether this is a net win: **sub-agent** parks that crossed their five-minute floor, and narrowed runs whose actual duration crossed it. Both should sit near zero. A non-zero first number means the ceiling is wrong; a non-zero second means narrowing bought nothing and burned the cache anyway, which the park counter alone would report as success. Main-session and interactive waits are excluded from both — they have an hour of headroom, and counting them would drown the signal.

Nothing here touches CI. `CHECK_SLOTS` is already off under CI and a runner running one job needs no governor.

## References

- PR #6598 — the counter this extends: `dev/scripts/check-queue.mjs` and [specs/setup/check-slots.feature](../../../specs/setup/check-slots.feature).
- [specs/setup/haven-resource-caps.feature](../../../specs/setup/haven-resource-caps.feature) — the per-service caps this sits above
- [ADR-091](./091-haven-gate-agent-admission-and-cost-safety.md) — the hook that lets an agent's tool call reach this governor
- `platform/app/vitest.config.ts` — the `vmForks` choice and the 573 MB/fork measurement this ADR's arithmetic rests on
- Measured, not assumed: across 40 transcripts (14,121 cache-writing requests, ~53M cache-write tokens) sub-agents write `ephemeral_5m` 100% of the time and main sessions write `ephemeral_1h` 100% of the time, with no request writing both; a compiled Go panic exits 2; `taskpolicy` supports `-B` (un-demote), `-p` (running process), and `-m` (spawn-time jetsam memory limit)
