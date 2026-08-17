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
tight. The program is also fatter than it needs to be: 52 MB of first-party
source reaches the compiler, of which 11 MB is generated Prisma types and 7.7 MB
is a single generated Ajv validator on 19 lines. That validator carries
`@ts-nocheck` and has a sibling `.d.ts`, so it was parsed and bound for no
benefit at all — `allowJs` plus an `./src/**/*` include swept it in as a root
file.

## Decision

**`CheckGoMemLimit` clamps to `[3, 6]` GiB instead of `[4, 10]`.** The policy
lives in Go (`tools/thuishaven/domain/checkslots.go`) with the JS queue
(`dev/scripts/check-queue.mjs`) mirroring it for machines without haven, so both
move together.

**The generated Ajv validator is excluded from the app's tsconfig**, where it
was a seventh of everything parsed and none of it checked.

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

Excluding the validator is separable from the clamp and cheaper to justify: it
has a sibling `.d.ts` that the import resolves to either way, so nothing is lost
by keeping the `.js` out of the program.

## Consequences

A typecheck should footprint around 6 GB rather than 9 GB on a 16-plus GiB
machine, at no measured cost in wall clock, and the compiler stops parsing
7.7 MB it never checked.

A locally built haven binary keeps the old clamp until `make haven install`, so
the change reaches developers on their next reinstall rather than immediately.

The remaining bulk in the program is generated Prisma types, at 11 MB across 111
files. Nothing here addresses that, and it is the obvious next place to look if
the working set ever becomes the binding constraint rather than the ceiling.

## References

- Related ADRs: [ADR-095](095-haven-tsgo-governor.md) (the governor whose
  `GOMEMLIMIT` policy this amends), [ADR-099](099-typescript-7-is-the-compiler.md)
  (the compiler move this was found alongside)
- Specs: `specs/setup/check-slots.feature`,
  `specs/setup/haven-tsgo-governor.feature`
