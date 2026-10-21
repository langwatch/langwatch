# ADR-002: Leaderboard intervals stay seeded bootstraps, made cheap on the CPU

**Date:** 2026-10-21

**Status:** Accepted

**Behavioural contract:** [Comparison leaderboard](../../../specs/experiments/comparison-leaderboard.feature)

## Context

The Comparison leaderboard computes three sets of intervals in the browser, during
render, every time a run's verdicts or costs change (each poll while a run is live):

- the Bradley-Terry score intervals, from 1,000 row resamples, each refitted by MM;
- a cost and a duration interval per variant, from 1,000 resamples of its rows;
- a cost and a duration interval for every PAIR of variants, from 1,000 resamples of
  the pair's per-row differences, each pair with its own seed.

The pairwise intervals grow with the square of the variant count. At twenty variants
and a thousand rows they took 3.5 seconds on the main thread; at fifty, over twenty
seconds. The score intervals took 0.2 seconds at twenty variants and 1.8 at fifty.

## Decision

Keep every interval a seeded percentile bootstrap. Do not switch to closed-form or
Hessian-based intervals: cost is right-skewed and bounded at zero (the reason the
bootstrap was chosen), N-way verdicts make one row's pairwise outcomes dependent, and
the share of resamples whose fit did not settle is itself shown to the reader.

Make them cheap instead:

1. The Bradley-Terry fit runs on flat typed arrays with buffers reused across
   replicates, divides each pair once, and rebuilds a replicate's win matrix from
   pre-encoded rows. It performs the same floating point operations in the same order
   as before, so scores, intervals and the non-convergence share are unchanged to the
   last digit.
2. The generator is written out inline and the 2.5% and 97.5% quantiles are found by
   selection instead of a full sort. The per-variant intervals are unchanged to the
   last digit.
3. Pairs that recorded at least 90% of the run's recorded rows share ONE resampling of
   those rows per metric. A pair's replicate is the mean difference over the drawn
   rows both sides recorded. For a pair that recorded every row this is the same
   paired bootstrap as before under a different seed; for one that missed a few rows
   the usable row count varies slightly between replicates, which widens the interval
   by under 1% of itself. Pairs that overlap less are resampled on their own, exactly
   as before.

Warm-starting each replicate from the full-data fit was measured and rejected: a fit
takes 21 to 72 MM iterations from a cold start, warm starting saved 4% to 19% of them,
and it would have moved the numbers off their current values.
WebGPU was rejected: it computes in 32-bit floats, below the solver's 1e-6 tolerance,
and its results only come back asynchronously, so it carries all of a worker's costs
without exact results.

## Consequences

Scores, score intervals and per-variant cost and duration intervals are identical to
what they were. Pairwise cost and duration intervals move by Monte Carlo noise (median
3% of the interval's width per bound, the same as changing the seed), and a pair's
interval still depends only on its own values, never on which other variants are in
the run.

Five variants now cost a few milliseconds per recompute. Twenty variants and above
still take longer than a frame; moving the work into a Web Worker is the remaining
step, and needs a decision on what the card shows while intervals are computing.
