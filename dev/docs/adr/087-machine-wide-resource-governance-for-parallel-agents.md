# ADR-087: A developer laptop running many agents needs one governor, not many limits

**Date:** 2026-08-06

**Status:** Proposed

**Relates to:** [ADR-064](./064-haven-cli-redesign.md) (the haven CLI and daemon this extends), [ADR-069](./069-payload-cost-doctrine.md) (the same "bound the cost at the seam that knows the cost" reasoning, applied to a queue rather than a laptop).

**Behavioural contract:** [specs/setup/heavy-run-admission.feature](../../../specs/setup/heavy-run-admission.feature), [specs/setup/memory-pressure-governor.feature](../../../specs/setup/memory-pressure-governor.feature).

## Context

A laptop driving one worktree is fine. The working state now is several worktrees under `.claude/worktrees/`, each with its own haven stack, and around ten agents editing and testing in parallel. That machine is unusable for minutes at a time, and it is worth being precise about why, because the obvious answer is wrong.

A measurement from an 11-core, 18 GiB machine mid-session: 17 `node` processes, each 24 threads, each 550–712 MB, PIDs clustered inside a 250-PID range — one simultaneous burst totalling about 10.5 GB. Alongside them a `limactl` VM at 8 GB, `biome` at 1 GB, `gopls` at 742 MB. Swap was 3.2 GB of 4 GB used and the compressor held 678k pages.

Those 17 processes are vitest `vmThreads` workers. The repo's guardrail is `maxWorkers: "50%"`, which on 11 cores is 5 workers **per run**. Three or four agents running `pnpm test:unit` at the same moment is 15–20 workers. The guardrail is per-run and there is no machine-wide one, so it does exactly what it says and the machine still dies.

`dev/scripts/check-queue.mjs` (#6598) already fixed this shape for `typecheck`, `lint` and `format`: one counter shared by every worktree, terminal and agent, a run past the limit waits its turn. That is the right mechanism. Three gaps remain.

**Tests are not on it.** The counter covers the checks, which are the smaller problem. The 10.5 GB burst above is uncounted.

**The limit is static and partly blind.** It derives from `os.totalmem()` and core count — one slot per 6 GiB, capped at one per 4 cores. On this machine that is a fixed 2, computed from 18 GiB of RAM that the process does not actually have: 8 GiB of it is inside a colima VM the queue cannot see. A limit derived from total RAM over-admits by exactly the amount some other tenant is holding.

**A wait can cost more than it saves.** `CHECK_QUEUE_MAX_WAIT_MS` defaults to 30 minutes. For a human at a terminal that is a good failsafe. For an agent it is not: a blocked tool call issues no API requests, and Anthropic's prompt cache expires on idle with a 5-minute floor. A run parked 6 minutes returns to a cold cache and pays a full re-read of the conversation at cache-write rates instead of cache-read — 1.15× base input across the whole prefix rather than 0.1×. Across ten agents, systematically parking them past the floor costs more than the RAM the parking protects. This is the constraint that shapes everything below, and it is why "queue harder" is the wrong direction.

Two structural notes. macOS has no cgroups, so there is no way to give a stack a hard memory bound; what it does have is `taskpolicy -b`, which moves a running process into the throttled background band for CPU and IO, and which children inherit. And summed RSS is not the pressure signal — it double-counts shared pages and overstates by several GB. The honest signals are the compressor's occupied pages and swap usage.

## Decision

**One counter covers every heavy run on the machine, and tests join it.** `check-queue.mjs` already is that counter; `test:unit` and `test:integration` route through it alongside `typecheck`, `lint` and `format`. They compete for the same cores and the same RAM, so they contend for the same slots. The counter keeps its current name and knobs — this is an extension, not a replacement.

**Narrowing comes before queueing.** A vitest run that cannot have a slot is not made to wait; it is given `--maxWorkers=N` sized to what is actually free and started immediately. A 2-worker run that starts now beats a 5-worker run that starts in six minutes, for RAM and for prompt cache alike. Queueing is the fallback for runs that cannot be narrowed (a typecheck is one process; there is nothing to divide), not the primary lever.

**A wait is bounded by the prompt-cache floor, not by patience.** Any wait haven imposes on a run it believes an agent is driving is capped well under the 5-minute floor. Past that the run proceeds narrowed, or is refused with a reason the caller can act on. The 30-minute failsafe stays for interactive use, where a human waiting is not an idle API session.

**The daemon publishes pressure; the callers read it.** The daemon already ticks every 10s. It samples the machine — compressor occupancy and swap, not summed RSS — classifies it green/amber/red, and writes that to its state directory. `check-queue.mjs` and `haven run` read the file when sizing slots and workers. The daemon does not reach into other processes to throttle them, and a missing or stale file means green: a governor that cannot read the machine must not throttle it.

**Under pressure the daemon demotes rather than kills.** Amber demotes every stack except the focused worktree into the background scheduling band via `taskpolicy -b`. Nothing loses work, the foreground stays responsive, and it is reversible. Red additionally names the largest stack and the command to stop it — it does not stop it. The daemon did not start that work and has no standing to end it.

**The daemon reclaims what is unambiguously garbage, and only that.** Interrupted vitest runs orphan their workers to `ppid 1`, which CLAUDE.md already documents as a manual `pkill` chore. A process matching the vitest worker path whose parent is `init` is owned by nobody and is swept on the tick. That is the whole rule; anything requiring a judgement about whether a process is still wanted stays manual.

**Drift the daemon cannot fix, it reports.** `Runtime.Ensure` applies colima limits only when haven creates the profile, deliberately, so it never resizes a VM someone else sized. The consequence is that an 8 GiB VM is invisible to haven forever. `haven doctor` compares the live profile against the configured budget and prints the exact commands to reconcile it. Reporting, not acting, is the correct half of that trade.

## Rationale / Trade-offs

The alternative was a hard per-stack memory bound — the thing a cgroup would give on Linux. It was rejected because macOS cannot express it, and every approximation of it (watch RSS, SIGKILL over a threshold) converts a slow machine into lost work. The existing `RunOnceBounded` reaper already covers the genuinely runaway case with an RSS and duration ceiling. What was missing was not a harder kill, it was admission.

The second alternative was to keep queueing as the only lever and simply raise the slot count. That is the status quo of #6598 extended to tests, and it is what the prompt-cache constraint rules out: queueing is the one response whose cost scales with how many agents are waiting, and it is invisible in every dashboard because a parked agent looks idle rather than expensive.

What is accepted in exchange. Narrowing trades wall-clock for admission — a 2-worker vitest run is slower than a 5-worker one, and on a quiet machine that is a pure loss, which is why narrowing only engages above green. The pressure signal is a heuristic with thresholds picked from observed behaviour, not a measurement of a limit the OS enforces; it will occasionally be wrong in both directions, and the fail-open default means it errs toward doing nothing. Demotion via `taskpolicy` is macOS-only, and the Linux path is left as plain queueing until someone needs it.

The 8 GiB VM is the honest illustration of the residual gap: after all of this, the single largest consumer on the machine is still outside haven's control, and the ADR's answer is a printed hint. That is a real limitation, not a rounding error.

## Consequences

`pnpm test:unit` becomes a queued and possibly narrowed command. The queue is silent when it does nothing, per #6598's existing contract, so the common case is unchanged — but a run that would previously have started 5 workers immediately may now start 2, and the wrapper says so.

The daemon gains a sampling responsibility on a tick it already runs, and a state file other processes read. That file becomes a compatibility surface: its absence must always be safe.

`haven doctor` gains lines for pressure, admission counts, and colima drift. One of those lines — how many runs were parked, and whether any park crossed the cache floor — is the metric that says whether this ADR is a net win. If it is ever non-zero the wait ceiling is wrong and the mechanism is costing more than it saves, so it is reported rather than left to inference.

Nothing here touches CI. `CHECK_SLOTS` is already off under CI, the pressure file will not exist there, and a runner running one job needs no governor.

## References

- PR #6598 — the existing counter this extends. **Not yet merged**: it adds `dev/scripts/check-queue.mjs` and `specs/setup/check-slots.feature`, so this ADR is stacked on it and its spec link resolves only once that lands.
- [specs/setup/haven-resource-caps.feature](../../../specs/setup/haven-resource-caps.feature) — the per-service caps this sits above
- [ADR-088](./088-haven-gate-agent-admission-and-cost-safety.md) — the hook that lets an agent's tool call reach this governor without haven invoking the agent
