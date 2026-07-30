# ADR-069: Payload cost is a scheduling input — extraction at ingest, byte-denominated bounds, memory by grant

**Date:** 2026-07-24

**Status:** Accepted

**Shipping with this ADR (phase 1):** enqueue-time filtering on the event-subscriber contract, adopted by the coding-agent span-facts subscriber — the deferred ADR-066 scope-table item ("move the coding-agent-name gate before enqueue"), shipped. The enqueue-time *projection* that would also lift the derived slice at the seam is deliberately deferred to phase 2 (see Sequencing for why the seam is the wrong place for it). Phases 2–4 are sequenced follow-ups (below), not built here.

**Also shipped, out of phase order:** the seam grew a second hook, `stage`, and the coding-agent span-facts subscriber now travels as a claim-check rather than carrying the matched span whole — the claim-check half of phase 2, landed early. It arrived stacked onto this ADR's PR rather than after it, so the Sequencing section below does not read in shipping order on its own. **Read the 2026-07 amendment at the end before treating anything in phase 2 as unbuilt**; it states precisely which half shipped and which did not.

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

1. **Phase 1 — invariant 4, the filter half (ships with this ADR).** The
   event-subscriber contract gains one enqueue-time option: a *filter*,
   evaluated at routing time, before a job is staged — `false` means no job is
   ever minted. The coding-agent span-facts subscriber adopts it: the name gate
   moves from the handler to the filter seam, so a span from any other trace
   never mints a job. This is the half of invariant 4 that dissolves the
   observed incident — the 578-deep group formed because a *non-agent* project
   minted a `codingAgentSpanFactsDispatch` job for every span it ingested, and
   the filter makes those jobs not exist. Enqueue outcomes (filtered / staged)
   are counted, following the existing event-sourcing metric conventions —
   minimal, but enough to see the seam working.

   The *projection* half — lifting the derived slice at the seam so the staged
   job carries ~2 KB instead of the full span — is **not** shipped here, by
   design. The enqueue seam runs on the shared routing-dispatch path, and that
   path **has no retry**: `EventSourcingService.storeEvents` logs a dispatch
   failure and continues, so that a projection fault cannot fail an
   already-committed write, and nothing re-dispatches subscriber fan-out
   afterwards. Work that throws at the seam therefore loses its job
   permanently, where the same work in the subscriber's own consumer lane
   merely retries that one job. Only *cheap and total* work belongs on the
   seam. A filter is both. The span projection is neither — it runs the full
   canonicalisation registry, which can throw on malformed span data — so
   moving it to the seam would convert a retryable per-job failure into a
   silent permanent drop for exactly the spans most likely to need a retry.
   The normalization therefore stays in the subscriber's own consumer lane, and
   the slice-on-the-wire optimization folds into phase 2, where the event
   carries a cost-honest claim-check natively (invariant 1) and no
   per-subscriber projection hook is needed at all. Filtering alone bounds the
   matched payloads by real coding-agent volume, which is not the runaway the
   non-agent flood was.
2. **Phase 2 — invariants 1 + 2.** Blob references carry the payload's true
   byte size (and decode-expansion hint where known), and the remaining
   holding stages — per-job dispatch in flight, retry buffers — get byte
   bounds. Honest sizes come first within the phase: a byte bound over stub
   sizes is the blindness the Context describes. This is also where the matched
   coding-agent span stops riding whole: with the event carrying a cost-honest
   claim-check, the subscriber reads the slice from the reference instead of the
   full payload — the slice-on-the-wire win phase 1 deferred, landed on the
   right substrate instead of on the routing-dispatch seam. (The claim-check
   half of this clause shipped early for `codingAgentSpanFactsDispatch`; the
   cost-honesty half did not — see the 2026-07 amendment below.)
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

- **The observed driver dissolves structurally.** Non-matching events never
  become jobs — the 578-deep group formed from a non-agent project's spans, and
  it now has no mechanism to form. This is the same shape of claim ADR-066 made
  for refolds: not "tuned smaller", but "no configuration surface on which to
  recur". Matched spans still travel as full payloads until phase 2 replaces
  them with claim-checks; that residual is bounded by real coding-agent volume,
  not by all-project span volume. (Superseded for this one subscriber — see the
  2026-07 amendment below.)
- **The platform gains a cost vocabulary.** "How many bytes is this job, and
  who granted them?" becomes an answerable question, which is what phases 2–4
  are built on — and what alerting can finally be written against, instead of
  alerting on the kubelet's opinion.
- **Overload changes shape, deliberately.** Queue depth grows where RSS used
  to; a backlog is durable and visible where an OOM kill was lossy and
  post-hoc. Operators watch depth and grant saturation, not allocator
  folklore.
- **The subscriber contract grows a seam authors must respect, with a sharp
  edge.** A filter runs on the shared routing-dispatch path, which has no
  retry — a throw there is reported loudly (logged, and surfaced as an
  `AggregateError` from `dispatch`) but still loses that subscriber's job for
  that event permanently. Blast radius is one `(subscriber, event)` pair, not
  the batch. So an enqueue hook must be **total**, not merely cheap, and
  anything data-dependent or fallible stays in the subscriber's own consumer
  lane where a failure retries just that job. This is the doctrine's one
  genuinely load-bearing rule for future adopters; it is contract, spec-pinned,
  not convention. Making the routing path retryable is a separate change to
  `storeEvents` error handling with its own blast radius — deliberately not
  taken here, and the reason the rule is stated as a restriction rather than a
  promise.
- **Phases 2–4 are real, sequenced work.** Until phase 2 lands, byte budgets
  remain stub-blind and the non-drain stages remain count-bounded; until
  phase 3, memory is still discovered rather than granted. The sequencing
  section exists so this gap is a tracked plan, not an ambient hope — the
  ADR-066 scope-table deferral is the cautionary precedent.

## Amendment: the claim-check half of phase 2, shipped early for one subscriber (2026-07, #6117 — stacked onto #6111)

`codingAgentSpanFactsDispatch` no longer stages the matched span whole. The
enqueue seam grew a second total hook (`stage`) beside `filter`, and a matched
`span_received` is swapped for a small versioned `span_referenced` event
carrying the span's identity — tenant, trace, span id, and the span's own
`startTimeUnixMs` — while the payload stays in the span store. The handler
resolves it back through `spanStorage` and lifts the facts from that canonical
row. This is the "matched coding-agent span stops riding whole" clause of phase
2 above, landed ahead of its phase.

Read the sequencing accordingly: **the claim-check half is shipped for this one
subscriber; the cost-honesty half is not.** `span_referenced` declares no byte
size, so invariant 1 is still unmet and the phase-2 work it gates — byte-bounded
in-flight and retry stages (invariant 2), and the grant pool behind it (phase 3)
— is untouched. The remaining `@planned` scenarios in the spec are the honest
statement of what is left. A future phase-2 implementer should read this as "the
reference mechanism exists and has one adopter", not as "phase 2 is underway".

Three consequences worth naming rather than discovering:

- **A build that predates the type drops the reference silently.** `span_referenced` is a new event type, so a pre-#6117 worker draining a job staged by a new one fails its `span_received` type check, returns, and **completes the job**. No throw, no drop counter, no log — the span facts for that event are simply gone. The version gate does not help: it protects a build that already knows the type against a *future* version, not a build that has never heard of it. #6117 was written to be deployed consumer-first for exactly this reason, and then merged stacked onto #6111, so both halves shipped in one commit and the protection was lost. **Any future adopter of `stage` must ship the consumer half at least one release ahead of the producer half** — the one-release consumer-first deploy is the mechanism, and it only works if the two halves ship apart.

  **Decided (2026-07-28): this adopter is NOT retrofitted with a producer flag.** For the hosted fleet the window has already passed — #6111/#6117 are merged and deployed. The exposure that remains is a **self-hosted upgrade crossing the #6117 boundary in one step**, where coding-agent span facts landing on a not-yet-restarted worker are lost silently. Accepted, and recorded here so it is not rediscovered.

- **Span-facts delivery is now store-dependent.** The subscriber was previously
  self-contained: everything it needed was in the job. It now depends on the
  spanStorage projection having landed the row and on the ClickHouse read
  succeeding. A miss is thrown deliberately (retry, never a silent drop) and the
  2s stage delay debounces the ordinary race against the sibling write — but a
  genuine store outage now delays these facts, where before it could not touch
  them.
- **The recovery path is the shared one, on purpose.** Store misses retry on the
  platform-wide `JOB_RETRY_CONFIG` (25 attempts, ≈2h27m cumulative), which is
  sized for exactly this failure — riding out a ClickHouse rolling restart or
  ZooKeeper session recovery without parking the group. An outage outliving that
  budget exhausts the job and blocks the per-trace group; the staged references
  are preserved in Redis, so recovery is an operator unblock (delayed delivery
  and toil, never loss). A store-miss-specific backoff or per-error-class
  attempt budget was considered and **not** taken: the budget is one shared
  platform policy, and carving out a per-subscriber knob is a change to the
  queue contract with its own blast radius, not a line in this PR. If this class
  of blocked group is observed in practice, that knob is the follow-up — with
  the retry metrics to size it, per ADR-068's measure-before-you-limit rule.

## References

- **Behavioural contract:** [specs/event-sourcing/payload-cost.feature](../../../specs/event-sourcing/payload-cost.feature) (phase 1 scenarios; phases 2–4 recorded as planned scenarios)
- [ADR-066](./066-projection-clickhouse-cached-store.md) — `event_log` off the per-item hot path; its *Scope* table's `codingAgentSpanFactsDispatch` line ("move the coding-agent-name gate before enqueue") is shipped by this ADR's phase 1
- [ADR-068](./068-windowed-clickhouse-reads.md) — the sibling doctrine: make the hidden cost visible/declared before bounding it
- [ADR-022](./022-event-log-source-of-truth.md) — heavy-content blob offload (the claim-check references invariant 1 makes cost-honest)
