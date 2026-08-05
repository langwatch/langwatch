# ADR-087: A developer laptop running many agents needs one governor, not many limits

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-064](./064-haven-cli-redesign.md) (the haven CLI and daemon this extends), [ADR-069](./069-payload-cost-doctrine.md) (the same "bound the cost at the seam that knows the cost" reasoning, applied to a queue rather than a laptop).

**Behavioural contract:** [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature), [specs/setup/memory-pressure-governor.feature](../../../specs/setup/memory-pressure-governor.feature).

## Context

A laptop driving one worktree is fine. The working state now is several worktrees under `.claude/worktrees/`, each with its own haven stack, and around ten agents editing and testing in parallel. That machine is unusable for minutes at a time, and it is worth being precise about why, because the obvious answer is wrong.

A measurement from an 11-core, 18 GiB machine mid-session: 17 `node` processes, each 24 threads, each 550–712 MB, PIDs clustered inside a 250-PID range — one simultaneous burst totalling about 10.5 GB. Alongside them a `limactl` VM at 8 GB, `biome` at 1 GB, `gopls` at 742 MB. Swap was 3.2 GB of 4 GB used and the compressor occupied about 2 GiB (128k pages at the 16 KiB page size Apple silicon uses).

Those 17 processes are vitest workers under `pool: "vmForks"`, which `platform/app/vitest.config.ts` picks deliberately and whose comment records the reason: 128 MB per vmThreads worker against 573 MB per vmFork, traded for roughly 15% less wall clock. That measured 573 MB is what the observed 550–712 MB range is. The repo's guardrail is `maxWorkers: "50%"`, which on 11 cores is 5 workers **per run**. Three or four agents running `pnpm test:unit` at the same moment is 15–20 workers. The guardrail is per-run and there is no machine-wide one, so it does exactly what it says and the machine still dies.

`dev/scripts/check-queue.mjs` (PR #6598, open and unmerged) already fixed this shape for `typecheck`, `lint` and `format`: one counter shared by every worktree, terminal and agent, a run past the limit waits its turn. That is the right mechanism. Three gaps remain.

**Tests are not on it.** The counter covers the checks, which are the smaller problem. The 10.5 GB burst above is uncounted.

**The limit is static and partly blind.** It derives from `os.totalmem()` and core count — one slot per 6 GiB, capped at one per 4 cores. On this machine 18 GiB of RAM gives 3 and 11 cores gives 2, so the core cap decides and the answer is 2. But 8 GiB of that RAM is inside a colima VM the process cannot use, so the memory term is computed against a number that overstates what is available; on the ~10 GiB actually free the memory term would have given 1.

**A wait can cost more than it saves.** `CHECK_QUEUE_MAX_WAIT_MS` defaults to 30 minutes. For a human at a terminal that is a good failsafe. For an agent it is not: a blocked tool call issues no API requests, and Anthropic's prompt cache expires on idle with a 5-minute floor. A run parked six minutes returns to a cold cache and re-reads the conversation at the cache-write rate of 1.25× base input rather than the cache-read rate of 0.1× — a 1.15× premium across the whole prefix.

That last point has a corollary that took a review to surface, and it is the one that shapes the decision. **A running tool call issues no API requests either.** A narrowed run that takes ten minutes loses the cache exactly like a six-minute park does. So the cache only discriminates between admission options for runs that finish *inside* the floor; above it the cache is forfeit whatever we do, and the only thing left to optimise is the machine.

Two structural notes. macOS has no cgroups, so there is no way to give a stack a hard memory bound; what it does have is `taskpolicy -b`, which moves a process into the throttled background band for CPU and IO. Inheritance covers processes forked *after* the policy is set — it does not retroactively demote a tree of already-running children, which is exactly what a live stack is, so demotion must walk the process group rather than signal the launcher and assume. And summed RSS is not the pressure signal: `GroupRSS`'s `ps` summation double-counts shared pages and overstates by several GB. The honest signals are the compressor's occupied pages and swap usage.

## Decision

**One counter covers every heavy run on the machine, and tests join it.** `check-queue.mjs` already is that counter; `test:unit` and `test:integration` route through it alongside `typecheck`, `lint` and `format`. They compete for the same cores and RAM, so they contend for the same slots. The counter keeps its name and knobs — this is an extension, not a replacement.

**A run is admitted exactly once, and the outer holder wins.** `haven run --class heavy` (new, arriving with [ADR-088](./088-haven-gate-agent-admission-and-cost-safety.md)) holds a slot on the flock semaphore and exports a marker; `check-queue.mjs` sees that marker and stands down for that run. This is the rule #6598 already established for `haven typecheck`, which passes `CHECK_SLOTS=0` to the run it spawns for exactly this reason. Without it a rewrapped test run takes an outer slot and then waits for an inner one, and at a limit of 1 it waits for itself.

**Narrowing applies only to runs that finish inside the cache floor.** This is the corollary above, made operational. A run projected to complete within the floor even after narrowing is narrowed and started immediately, because that is the one case where narrowing buys a cache the alternative would lose. A run projected to exceed the floor either way is queued normally, on the full failsafe, because its cache is already forfeit and queueing is strictly better for the machine. **A run whose duration haven has not observed is treated as long and queued**, so the fail-safe direction is the conservative one. Duration comes from a rolling observation per command that haven keeps; there is no estimation heuristic.

**Narrowed runs still consume admission.** A narrowed run is not a free run. It takes a slot like any other, and the worker count it is given divides by the runs actually in flight rather than by the configured limit. Otherwise ten agents each start narrowed, nothing bounds the total, and 10 main processes plus their forks reproduce the original burst at full spec compliance.

**One precedence table decides admission, and every scenario maps to a row of it.**

| Pressure | Slot free | Projected to finish inside the floor | Outcome |
|---|---|---|---|
| green | yes | — | admit unchanged |
| green | no | yes | narrow, admit, consume a slot |
| green | no | no / unknown | queue |
| amber | yes | — | admit unchanged |
| amber | no | yes | narrow, admit, consume a slot |
| amber | no | no / unknown | queue |
| red | yes | — | admit unchanged |
| red | no | — | refuse, with a reason |

Red is the only level that refuses, and it refuses rather than queues because at red the queue is already long enough that the wait will not fit. Amber's job is to stop *widening* — it does not refuse work, it stops work being admitted at full width. That is the single reading; earlier drafts of this ADR carried three.

**The daemon publishes pressure; the callers read it.** The daemon already ticks every 10s. It samples the machine — compressor occupancy and swap — classifies it, and writes that to its state directory. `check-queue.mjs` and `haven run` read the file when sizing narrowing and deciding refusal.

**Fail-open is scoped to the pressure-derived behaviour only.** A missing, stale or unparseable pressure file reads as green, which disables narrowing and disables red's refusal. It does **not** disable slot counting: #6598's queue never depended on a pressure file, its occupancy comes from the queue directory, and a developer running plain `pnpm` without the haven daemon must keep exactly the protection they have today. A governor that cannot read the machine must not throttle it, and must not un-protect it either.

**Under pressure the daemon demotes rather than kills.** Amber demotes every stack except the focused worktree into the background band, walking the process group so already-running children are actually covered. Nothing loses work and it is reversible. Red additionally names the largest stack and the command to stop it — it does not stop it. The daemon did not start that work and has no standing to end it. Focus is the worktree of the most recently active stack; when focus cannot be determined, nothing is demoted.

**The daemon extends the orphan sweep that already exists.** `procsupervisor.reapOrphans` already sweeps dev-runtime processes whose parent is PID 1 in known directories at every `haven up`. The same rule runs on the daemon's tick and covers test workers. That is the whole rule — a process matching the worker path whose parent is PID 1 (launchd, on macOS) is owned by nobody. Anything requiring a judgement about whether a process is still wanted stays manual.

**Drift the daemon cannot fix, it reports.** `Runtime.Ensure` applies colima limits only when haven creates the profile, deliberately, so it never resizes a VM someone else sized. The consequence is that an 8 GiB VM is invisible to haven forever. `haven doctor` compares the live profile against the configured budget and prints the exact commands to reconcile it.

## Rationale / Trade-offs

The alternative was a hard per-stack memory bound — what a cgroup would give on Linux. Rejected because macOS cannot express it, and every approximation (watch RSS, SIGKILL over a threshold) converts a slow machine into lost work. `RunOnceBounded` already covers the genuinely runaway case with an RSS and duration ceiling. What was missing was admission, not a harder kill.

The second alternative was to keep queueing as the only lever. That is #6598 extended to tests, and it is what the cache floor rules out for short runs — queueing is the one response whose cost scales with how many agents are waiting, and a parked agent is invisible in every dashboard because it looks idle rather than expensive.

**Narrowing has to answer to CLAUDE.md, which calls it an anti-pattern**, in the row about reaching for `--maxWorkers=1`: it "serializes the run so it stays resident far longer, overlapping every other agent's run. Scope the run down instead — pass a narrower path." That row is right, and it is about the degenerate case. Narrowing to one worker maximises residency for minimum benefit. This ADR narrows *bounded*, only where the narrowed run still fits inside the floor, which caps the residency extension at a few minutes by construction — and where the run does not fit, it agrees with CLAUDE.md and queues instead. Scoping the run down remains the better answer whenever the caller can do it, and a caller who has already passed a worker count keeps it.

What is accepted in exchange. Narrowing trades wall-clock for admission, and on a quiet machine that is a pure loss, which is why it only engages when no slot is free. The pressure signal is a heuristic with thresholds picked from observed behaviour, not a limit the OS enforces; it will be wrong in both directions, and fail-open means it errs toward doing nothing. Demotion via `taskpolicy` is macOS-only; the Linux path is plain queueing until someone needs it. Duration observation means the first run of any command queues rather than narrows, which is the correct default but does mean the mechanism is cold on a fresh machine.

The 8 GiB VM is the honest illustration of the residual gap: after all of this, the largest single consumer on the machine is still outside haven's control, and the answer is a printed hint.

## Consequences

`pnpm test:unit` becomes a queued and possibly narrowed command. The queue is silent when it does nothing, per #6598's contract, so the common case is unchanged.

The daemon gains a sampling responsibility on a tick it already runs, and a state file other processes read. That file needs a version field, a staleness threshold, and a documented reading for an unparseable one — all three resolve to green.

There is a second, reverse channel this ADR requires and does not yet specify: the doctor's counters describe things `check-queue.mjs` knows, and it is a transient node process whose queue entries are deleted on release. Somewhere to append those events, that haven reads, is a real surface and is named here so it is not discovered during implementation.

`haven doctor` gains lines for pressure, admission counts, and colima drift. Two of those are the metrics that say whether this ADR is a net win: **agent-driven** parks that crossed the cache floor, and **narrowed runs whose actual duration crossed it**. The second exists because narrowing can burn exactly the money parking would have while the first metric reads zero. Interactive parks are excluded from both — a human's twelve-minute wait is not an idle API session, and counting it would make the metric meaningless.

Nothing here touches CI. `CHECK_SLOTS` is already off under CI, the pressure file will not exist there, and a runner running one job needs no governor.

## References

- PR #6598 — the counter this extends. **Not yet merged**: it adds `dev/scripts/check-queue.mjs` and `specs/setup/check-slots.feature`, so this ADR is stacked on it and that spec link resolves only once it lands.
- [specs/setup/haven-resource-caps.feature](../../../specs/setup/haven-resource-caps.feature) — the per-service caps this sits above
- [ADR-088](./088-haven-gate-agent-admission-and-cost-safety.md) — the hook that lets an agent's tool call reach this governor without haven invoking the agent
- `platform/app/vitest.config.ts` — the `vmForks` choice and the 573 MB/fork measurement this ADR's arithmetic rests on
