# ADR-046: Drop-to-replay is not a recovery strategy for reactor-bearing folds

**Date:** 2026-07-16

**Status:** Accepted

**Relates to:** [ADR-029](./029-groupqueue-content-addressed-payload-store.md) and [ADR-030](./030-groupqueue-blob-handling-hardening.md) (both amended by this decision to carry the reactor caveat), [ADR-022](./022-event-log-source-of-truth.md) (the source-of-truth invariant this scopes), `src/server/event-sourcing/queues/groupQueue/` (#5538 / PR #5821 named-and-counted the drops; the recoverability follow-ups add preserve + name + keep-the-blob).

## Context

Every discarding path in the GroupQueue justified itself with the same phrase — *"recover via event replay"* — and that phrase is **false for reactors**. It appeared, uncorrected, in at least six places across code, ADRs, an operator-facing migration comment, and two architecture docs. A premise that is wrong in six places and corrected in none re-justifies the exact silent drop for the next reader; that is the observed history of this defect, not a hypothetical. This ADR records the rule so it stops propagating.

The trigger was #5538 (GroupQueue drops staged jobs on decode failure). The parent fix (PR #5821) made every drop **named and counted**; the recoverability follow-ups make a body-present drop **preserved** (a job-scoped dead-letter) and every drop **nameable** (a recovery key in the envelope header, so even a reactor drop whose blob is gone is addressable to its `event_log` row). None of that would be safe to reason about while the codebase asserted the drops were already recovered by replay.

## Decision

**The rule.** Event replay rebuilds **fold and map** projections and **never invokes reactors**. So:

- A dropped **fold** or **map** job **is** replay-recoverable — `ReplayService.replay()` drives `config.projections` + `config.mapProjections`.
- A dropped **reactor** job is **not** replay-recoverable — `ReplayExecutor` calls the fold's pure `projection.apply()` and writes straight to the store, and never constructs a `ProjectionRouter`, which is the only thing that calls `dispatchToReactors`. Reactors are unreachable from replay **by construction**. The only reactor references under `replay/` exist to *suppress* re-fires (`replayMarkers.ts`, `replayMapPath.ts`), not to drive them, and `projectionRouter.ts` pins `LIVE_DISPATCH_IS_REPLAY = false`.

**The discriminator.** The question to ask at any discarding branch is: **is a reactor on the path?** If yes, "recover via replay" is false and the drop is real loss unless the job is preserved and named. The reactors on the drop window include customer-visible ones (`alertTrigger`, `cancellationBroadcast`, `traceUpdateBroadcast`) and, critically, two compliance sinks — `governanceOcsfEventsSync` (SOC2 / ISO27001 OCSF audit) and `gatewayBudgetSync` (billing) — both registered via `builder.withReactor("traceSummary", …)`, i.e. reactors **on** a fold, exactly the shape that reads as replay-covered but is not.

**The trap.** *Idempotent-on-replay ≠ something replays.* Several sites cite a `ReplacingMergeTree` key as "idempotency" and conclude the work is safe. A dedup key makes a **second** firing harmless; it does not **produce** a second firing. Nothing re-drives a dropped reactor job, so idempotency is irrelevant to whether it is recovered. This conflation appears independently in at least three places and is the specific reasoning error this record exists to name.

## Consequences

- **The six false-premise sites are corrected** (this PR): the two ADRs above carry the caveat; the OCSF ClickHouse repository doc and both `ARCHITECTURE.md` files are fixed; and migration `00026`'s operator-facing "drop + rebuild from `event_log`" claim — which is immutable history — is corrected via a **new** migration comment (the deployed file is never edited) that states the OCSF table is reactor-populated **and** that two of its writers (`adminWorkspaceViewAudit.service.ts`, `pullerWorker.ts`) have **zero** `event_log` representation, so a rebuild would total-lose those rows.
- **A CI guard** fails if the phrase re-appears near a discarding branch, proven by a planted-violation self-test — a guard that cannot disagree with its target is worthless.
- **This does not make replay reach reactors.** Doing that (a per-reactor replay-safety classification + a re-drive driver) is deliberately out of scope and blocked-by-design: a naive driver re-fires customer-visible reactors and sends duplicate alerts. `projectionRouter.ts` pre-specifies the extension point ("if a replay path that reaches reactors is ever added, it must thread a real flag"). Until that lands, a reactor drop is *recoverable-in-principle* (preserved + named) — **not** automatically recovered. Copy and code must say exactly that and no more.
