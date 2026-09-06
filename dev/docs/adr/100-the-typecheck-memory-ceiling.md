# ADR-100: The typecheck memory ceiling

**Date:** 2026-08-17

**Status:** Proposed

## Context

A typecheck was observed taking 9 GB on an 18 GiB laptop. The number is exact,
not approximate, and that is the tell: `CheckGoMemLimit` resolves `GOMEMLIMIT`
to half the machine, clamped to `[4, 10]` GiB, so an 18 GiB machine gets exactly
9 GiB. `GOMEMLIMIT` is a soft ceiling, not a reservation — the Go runtime
collects lazily and lets the heap expand toward it.

Sampled cold at four ceilings, the resident working set never left the
2.3–3.5 GB band while the footprint tracked whatever it was allowed:

| `GOMEMLIMIT` | max RSS | peak footprint |
|--------------|---------|----------------|
| 9 GiB        | 2.29 GB | 9.08 GB        |
| 6 GiB        | 2.26 GB | 6.57 GB        |
| 5 GiB        | 3.10 GB | 7.77 GB        |
| 3 GiB        | 3.48 GB | 6.13 GB        |

**There is deliberately no wall-clock column.** These were sampled on a laptop
running four worktree stacks at a load average of 80, and the times that came
back (121 s at 9 GiB, 409 s at 6, 840 s at 5, 207 s at 3) are not monotonic in
anything and are contention, not signal. What survives the noise is the shape:
the footprint follows the ceiling, the working set does not, and the tighter
ceilings spent conspicuously more system than user time — the signature of a
runtime collecting against a limit rather than working.

So the ceiling is too generous, and the floor people would reach for is too
tight.

## Decision

**`CheckGoMemLimit` clamps to `[3, 6]` GiB instead of `[4, 10]`.** The policy
lives in Go (`tools/thuishaven/domain/checkslots.go`) with the JS queue
(`dev/scripts/check-queue.mjs`) mirroring it for machines without haven, so both
move together.

## Rationale / Trade-offs

The honest statement of the evidence is narrower than the change, and worth
writing down as such. What the samples establish is that the working set stays
in a 2.3–3.5 GB band no matter what ceiling it is given, so a 6 GiB ceiling
cannot be the thing constraining it, while a 9 GiB one demonstrably gets spent.
What they do not establish is that 6 is optimal: **the specific number is a
judgement between measured points, not a measured optimum**, because the machine
was too loaded for the timings to mean anything. It deserves a clean re-measure
on a quiet machine, and the direction survives either way — anything at or below
6 hands out strictly less than 10 did, with a working set that never came close
to needing it.

The floor of 3 is there because a ceiling below the live heap is the worse
failure of the two: the runtime cannot collect its way under it, so it pays the
collection cost continuously and misses the target anyway, which is what the
3 GiB sample's 6.13 GB footprint is.

## Consequences

A typecheck should footprint around 6 GB rather than 9 GB on a 16-plus GiB
machine, **with the wall-clock impact not established** — the sampling machine
was too loaded for its timings to carry any, which is the same reason the table
above has no wall-clock column.

A locally built haven binary keeps the old clamp until `make haven install`, so
the change reaches developers on their next reinstall rather than immediately.

## Amendment: pressure mode (2026-08-19)

The clamp above still assumes an otherwise idle machine. Measured on the same
18 GiB laptop while it was **not** idle (swap 89% full, compressor holding
42 GB compressed into 7.7 GB of RAM, `kern.memorystatus_vm_pressure_level` at
warning), an uncapped cold typecheck footprinted **7.26 GB** peak with a max
RSS of only 1.9 GB: most of its pages were compressed or swapped in the same
breath they were allocated, which is the eviction storm the person at the
keyboard feels. The time split says the same thing: 331 s wall, **80 s user
against 162 s system**, twice as much kernel time (paging) as compiling. CPU
never exceeded ~2.8 of 11 cores, so on a pressured machine the constraint is
memory, and killing the run by hand was rational. That is what people do, and
it is what reads back afterwards as a mystery exit 137.

So the queue now reads the machine's pressure level (ADR-090's
`ClassifyPressure`: swap fill or compressor occupancy, either alone) at spawn,
and under amber or red runs every check in its smallest shape:

- `GOMEMLIMIT` resolves to the **floor (3 GiB)** outright. The ceiling is
  garbage the runtime has not collected because it was told there was room;
  under pressure there is no room, and every granted gigabyte evicts someone
  else's pages. The floor trades that for the run's own GC time, so the check
  pays for the shortage instead of the machine.
- `GOMAXPROCS` is halved (never below two). Eleven runnable threads all
  taking page faults is what a seized machine feels like; half of them buys
  back interactivity for a modest wall cost.
- The machine-derived slot limit narrows to **one**. The formula's per-run
  budget assumes RAM that a pressured machine does not have.

Explicit `GOMEMLIMIT`, `GOMAXPROCS` and `CHECK_SLOTS` still win, and
`CHECK_PRESSURE=green|amber|red` forces the level (for tests, and for an
operator who knows better). A machine the queue cannot read is green: a
governor that cannot see must not throttle.

With no forced level, CI reads green by rule, before any measurement. An
explicit `CHECK_PRESSURE` is read first and still wins there, for a CI test that
needs a level. Otherwise the queue already stands down on a runner, and the same
reasoning retires the pressure policy with it: a runner runs one job, nobody is
typing on it, so buying back an interactive machine buys nothing and only makes
the job slower. A swap figure read inside a container also describes the host
rather than the job. The rule is what makes "CI is unaffected" true, instead of
true by accident of the runner's kernel.

What was measured, on the 18 GiB / 11-core machine described above, so a later
reader does not have to trust a PR link:

| | uncapped, red machine | pressured shape |
|---|---|---|
| `GOMEMLIMIT` | 6 GiB (the clamp) | 3 GiB (the floor) |
| `GOMAXPROCS` | unset, 11 cores | 5 |
| peak footprint | 7.26 GB | not comparable, see below |
| max RSS | 1.9 GB | about 1 to 2 GB |
| wall / user / system | 331 s / 80 s / 162 s | not established |
| peak CPU | ~2.8 of 11 cores | not sampled |

The pressured column is thinner on purpose. `--explain` resolved
`pressure=red gomemlimit=3GiB gomaxprocs=5`, and this PR's own `typecheck:tests`
ran to a clean exit inside that shape, but a matched **cold** run was stopped by
hand when swap reached 15.6 of 16.4 GB, two days after a swap-exhaustion kernel
panic on the same machine. So the ceiling and the parallelism are confirmed to
apply, and the wall-clock cost of applying them is not. Reproduce with:

```bash
/bin/rm -f platform/app/node_modules/.cache/tsbuildinfo/tsgo-app.tsbuildinfo
/usr/bin/time -l node dev/scripts/check-queue.mjs \
  ./platform/app/node_modules/.bin/tsc.real --noEmit -p platform/app/tsconfig.tsgo.json
```

with `CHECK_PRESSURE` set to `green` and then `red` for the two columns.

There is no swap-only-the-check mechanism to reach for instead: macOS offers no
per-process swap steering, and `taskpolicy -b` (background QoS) was measured
starving a typecheck to 0.3 to 4% CPU for eight minutes on a pressured machine,
because background priority deprioritizes the page-ins it needs to make progress
at all.

## References

- Related ADRs: [ADR-090](090-haven-pressure-governor.md) (the pressure levels
  and thresholds this reuses), [ADR-095](095-haven-tsgo-governor.md) (the
  governor whose `GOMEMLIMIT` policy this amends),
  [ADR-099](099-typescript-7-is-the-compiler.md)
  (the compiler move this was found alongside)
- Specs: `specs/setup/check-slots.feature`,
  `specs/setup/haven-tsgo-governor.feature`
