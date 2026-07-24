# ADR-069: Payload cost is a scheduling input — extraction at ingest, byte-denominated bounds, memory by grant

**Date:** 2026-07-24

**Status:** Accepted

**Shipping with this ADR (phase 1):** enqueue-time filtering and enqueue-time projection on the event-subscriber contract, adopted by the coding-agent span-facts subscriber — the deferred ADR-066 scope-table item ("move the coding-agent-name gate before enqueue"), shipped, plus the projection that goes with it. Phases 2–4 are sequenced follow-ups (below), not built here.

**Builds on:** [ADR-066](./066-projection-clickhouse-cached-store.md) — the same economics, one plane over. ADR-066 took `event_log` off the per-item hot path; this ADR takes bulk payloads off the per-item *scheduling* plane. Its scope table already named this ADR's phase 1 and deferred it.

**Sibling doctrine:** [ADR-068](./068-windowed-clickhouse-reads.md) — 068's discipline is *measure before you limit*: a fallback cannot be rate-limited while it is invisible. This ADR is the memory-plane statement of the same discipline: a scheduler cannot budget a cost that is not declared. Both replace "hope, then get killed" with "see, then bound".

**Relates to:** [ADR-022](./022-event-log-source-of-truth.md) (heavy-content blob offload — the claim-check mechanism whose references invariant 1 makes cost-honest).

**Specs:** [specs/event-sourcing/payload-cost.feature](../../../specs/event-sourcing/payload-cost.feature).

## Context

The worker fleet has a recurring failure class: a worker's RSS climbs to a
multiple of its heap, the event loop stalls under cgroup memory pressure, the
liveness probe times out, and the kubelet kills the process. Nothing in the
application decided to shed load — the platform decided for it, at the cost of
every in-flight job in the process.

The 2026-07-24 instance of the class shows the anatomy. One subscriber needed
roughly twenty small fields from coding-agent spans. To get them, the pipeline:

1. **minted a job for every span event in every project** — the "is this a
   coding-agent span?" gate ran inside the handler, *after* dequeue, so
   non-matching spans (the vast majority) each paid a full stage/dequeue cycle
   to be discarded;
2. **carried the full raw span payload on each job** — multi-MB payloads riding
   the scheduling plane to deliver ~2 KB of derived facts;
3. **rehydrated and normalized the whole payload in the handler** to lift the
   small fields — full I/O, decode, and GC cost, re-paid per job, for data the
   ingest path had already held in memory once.

A hot trace (the same hot project as the 2026-07-23 outage behind ADR-066)
backed one subscriber group up 578+ jobs deep, each holding a heavyweight
payload, and the worker's memory was gone. ADR-066's scope table had already
named the enqueue-side gate as the fix and deferred it; the deferral cost us
the incident.

The subscriber is the instance. Two structural gaps make it a class:

- **Byte budgets exist only on coalesced drains** (ADR-066 pillar 2). Every
  other stage that holds items — per-job dispatch in flight, retry buffers —
  is bounded by *count*, and count bounds fail exactly when sizes vary. This
  workload's defining feature is six orders of magnitude of payload-size
  variance: a count that is safe for the median is fatal for the tail, and a
  count safe for the tail idles the fleet.
- **The one byte budget we have counts the staged envelope, not the payload.**
  Blob-offloaded payloads stage as small stubs, so the drain's byte bound is
  blind to true size — the drain's own implementation notes admit the scope
  ("for the small inline appends this targets"). A budget that cannot see the
  cost cannot bound it.

Underneath both gaps is the design smell this ADR names: **memory cost is
discovered at hydration time instead of declared at scheduling time.** The
scheduler admits work by count, the work turns out to be heavy, and the first
component to notice is the allocator — at which point the only actor with a
shedding policy left is the kubelet.

## Decision

Payload cost becomes a first-class input to scheduling. Seven invariants,
stated as platform rules. Phase 1 (below) ships invariant 4; the rest are the
doctrine the follow-up phases implement, recorded now so each phase lands
against a fixed target.

1. **Claim checks advertise their cost.** Bulk data never rides the scheduling
   plane; a blob reference always carries the payload's true byte size (and,
   where known, a decode-expansion hint). A scheduler cannot budget what it
   cannot see — an honest reference is what makes every other bound in this
   list enforceable.

2. **Every bound is denominated in the scarce resource.** A memory-bound stage
   budgets bytes, never counts. Count limits fail exactly when sizes vary, and
   size variance is this workload's defining feature. This applies to every
   stage that holds items: drains, in-flight sets, retry buffers.

3. **Memory is acquired, not discovered.** A job presents its declared cost and
   takes a grant from a bounded per-process pool *before* hydration; no grant →
   it waits as a pointer (cheap), never as RSS (fatal). Overload therefore
   manifests as queue depth — visible, alertable, and durable — never as
   allocator pressure.

4. **Extraction happens where the data already is.** If a consumer needs a
   small projection of a large payload, it is lifted at ingest — when the
   payload is necessarily in memory — and the derived slice flows through the
   pipeline. Rehydrating a blob to run a cheap projection pays full
   I/O + decode + GC for a fraction of the data. Filters go even earlier: a
   predicate evaluable pre-enqueue means the job never exists at all.

5. **Per-key fairness.** A hot aggregate degrades itself, never the fleet. The
   GroupQueue's per-aggregate serialization is the skeleton; fairness is
   cost-aware scheduling *across* groups, so one aggregate's backlog cannot
   monopolize the workers every other aggregate shares.

6. **Bulkheads for the heavy class.** A workload class 100–1000× heavier than
   the median gets its own pool and budget, so heavy-class overload stays a
   heavy-class incident instead of a fleet incident.

7. **The system sheds itself before the platform sheds it.** The degradation
   order is chosen, not suffered: pause intake (grants exhausted) →
   defer/spill (durable) → park with operator visibility. A liveness-probe
   kill for load reasons means a shedding layer is missing — it is a defect in
   this doctrine's implementation, never an acceptable steady state.

## Sequencing

Ordered by leverage: each phase dissolves the largest remaining share of the
incident class, and each later phase depends on what the earlier ones make
visible.

1. **Phase 1 — invariant 4 (ships with this ADR).** The event-subscriber
   contract gains two enqueue-time options: a *filter* (evaluated at routing
   time, before a job is staged — `false` means no job is ever minted; the
   predicate must be cheap and total, because a throw fails the routing attempt
   into its retry path) and a *projection* (applied at staging — the staged job
   carries the derived slice instead of the full event, with the subscriber's
   per-key serialization, dedup window, and retry semantics unchanged). The
   coding-agent span-facts subscriber adopts both: the name gate moves from the
   handler to the filter seam, and the normalization + fact-lifting moves from
   the handler to the projection, shrinking the staged payload from the full
   span to the ~2 KB of derived facts and the handler to "send the command".
   Jobs staged by the previous build still carry the full event, so the handler
   recognizes both shapes for the transition window and processes pre-upgrade
   jobs exactly as before. Enqueue outcomes (filtered / projected / staged
   whole) are counted, following the existing event-sourcing metric
   conventions — minimal, but enough to see the seam working.
2. **Phase 2 — invariants 1 + 2.** Blob references carry the payload's true
   byte size (and decode-expansion hint where known), and the remaining
   holding stages — per-job dispatch in flight, retry buffers — get byte
   bounds. Honest sizes come first within the phase: a byte bound over stub
   sizes is the blindness the Context describes.
3. **Phase 3 — invariant 3.** The per-process memory grant pool.
   **Precondition: phase 2** — a grant is taken against a declared cost, so
   costs must be honest before a pool can budget them.
4. **Phase 4 — invariants 5, 6, 7.** Cost-aware fairness across groups,
   bulkheads for the heavy class, and the shedding ladder.
   **Precondition: phase 3** — the grant pool is both the sensor (grants
   exhausted is the intake-pause signal) and the ledger fairness and bulkheads
   divide; without it, shedding has nothing principled to trigger on.

## Alternatives considered

- **Bigger memory limits.** Raise the cgroup ceiling and the probe timeouts
  until the incidents stop. This is paying to stay blind: the process still has
  no idea what its work costs, so the same unbounded admission walks into the
  new ceiling at the next hot aggregate — at a higher RSS and a higher bill.
  ADR-066 made the same call on the ClickHouse server ("the merge-OOM is not
  fixed by adding memory"); it holds here for the same reason. Rejected.
- **Count-based tuning.** Lower the concurrency numbers, shrink the batch
  counts, add per-subscriber count caps. Fails on variance: with six orders of
  magnitude between the smallest and largest payloads, no count is
  simultaneously safe for the tail and productive for the median. Every tuned
  count is a bet on the size distribution staying put, and a hot project is
  precisely the size distribution not staying put. Rejected.
- **Handling it purely operationally.** Runbooks, replica bumps, hand-parking
  hot projects when the pager fires. This leaves the kubelet as the platform's
  backpressure mechanism and the on-call as its shedding layer — every
  incident re-diagnosed from the same graphs, every kill taking innocent
  in-flight work with it. Operations is how we survive the class today; it is
  not a decision about the class. Rejected as the steady state.

## Consequences

- **The current driver class dissolves structurally.** Non-matching events
  never become jobs, and matching events travel as their derived slice — the
  578-deep group of multi-MB payloads has no mechanism left to form. This is
  the same shape of claim ADR-066 made for refolds: not "tuned smaller", but
  "no configuration surface on which to recur".
- **The platform gains a cost vocabulary.** "How many bytes is this job, and
  who granted them?" becomes an answerable question, which is what phases 2–4
  are built on — and what alerting can finally be written against, instead of
  alerting on the kubelet's opinion.
- **Overload changes shape, deliberately.** Queue depth grows where RSS used
  to; a backlog is durable and visible where an OOM kill was lossy and
  post-hoc. Operators watch depth and grant saturation, not allocator
  folklore.
- **The subscriber contract grows a seam authors must respect.** A filter must
  be cheap and total — a throw fails the routing attempt into its retry path,
  loudly, never a silent drop — and a projection puts a second payload shape
  on the wire for the mixed-deploy window. Both are contract, spec-pinned, not
  convention.
- **Phases 2–4 are real, sequenced work.** Until phase 2 lands, byte budgets
  remain stub-blind and the non-drain stages remain count-bounded; until
  phase 3, memory is still discovered rather than granted. The sequencing
  section exists so this gap is a tracked plan, not an ambient hope — the
  ADR-066 scope-table deferral is the cautionary precedent.

## References

- **Behavioural contract:** [specs/event-sourcing/payload-cost.feature](../../../specs/event-sourcing/payload-cost.feature) (phase 1 scenarios; phases 2–4 recorded as planned scenarios)
- [ADR-066](./066-projection-clickhouse-cached-store.md) — `event_log` off the per-item hot path; its *Scope* table's `codingAgentSpanFactsDispatch` line ("move the coding-agent-name gate before enqueue") is shipped by this ADR's phase 1
- [ADR-068](./068-windowed-clickhouse-reads.md) — the sibling doctrine: make the hidden cost visible/declared before bounding it
- [ADR-022](./022-event-log-source-of-truth.md) — heavy-content blob offload (the claim-check references invariant 1 makes cost-honest)
