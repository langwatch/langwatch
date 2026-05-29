Feature: Work-conserving max-min fair dispatch
  As an operator running multi-tenant event-sourcing on a shared worker fleet
  I want a tenant to use as much capacity as is free, and to be throttled only
  when it is actually starving another tenant
  So that spare capacity is never left idle behind a fixed cap, and fairness
  kicks in exactly when, and only when, tenants are competing for scarce slots.

  # Why this supersedes the fixed per-tenant cap (event-sourcing/tenant-soft-cap.feature)
  #
  # The fixed soft cap (a flat N concurrent groups per tenant) is not
  # work-conserving: on 2026-05-28 the worker fleet sat ~66% utilized (hundreds
  # of idle slots) while a bursty tenant had groups parked behind its cap. Idle
  # capacity behind a throttle is pure waste. Raising the fixed number does not
  # fix it: a high cap just lets a big tenant starve small ones instead. Equal
  # sharing (capacity / N) does not fix it either: under asymmetric demand (one
  # big bursty tenant plus many tiny ones, which is our normal shape) an equal
  # share strands the big tenant below capacity while the small tenants leave
  # their slices unused. That recreates the exact "throttled while there is
  # clearly room" complaint, just moved onto the big tenant.
  #
  # The principle: a tenant may consume whatever capacity is otherwise idle.
  # Throttling engages only when the fleet is SATURATED and another tenant has
  # work waiting that would be starved. Under contention the entitlement is a
  # max-min fair share: capacity divided across the tenants that currently have
  # waiting work, with any share a tenant does not need redistributed to those
  # that do. There is no fixed ceiling and no computed allocation; the
  # anti-runaway protection (the 2026-05-11 500K-group incident) becomes
  # starvation-triggered, which is strictly stronger than a blanket cap because
  # it never penalises a tenant that is not starving anyone.
  #
  # How fairness is produced (no allocation is ever computed):
  #   When a slot frees, the waiting tenant with the FEWEST in-flight groups
  #   wins it. Repeating that greedy choice converges to max-min fair share by
  #   construction. One tenant alone is always the least-loaded, so it takes
  #   every idle slot (a burst is processed in full). Two tenants both wanting
  #   more than half ping-pong and converge to half each. A small tenant gets
  #   its full (small) demand and the big tenants split the rest. The split is
  #   emergent, not configured: there is no 80/20, no per-tenant cap number.
  #
  # Implementation invariants (learned from the 2026-05-27/28 incidents):
  #   - Selection reads a SOFT per-tenant load summary (member = tenantId,
  #     score = in-flight count) for a cheap O(log n) argmin over waiting
  #     tenants. The summary is ADVISORY: it orders selection only. It is
  #     reconciled from the authoritative tenant_active_z ZSET
  #     (ZREMRANGEBYSCORE -inf now to GC lapsed slots, then ZCARD) on the
  #     periodic GC pass. Drift in the summary mis-orders one selection window
  #     and self-heals on the next reconcile; it can NEVER stall dispatch or
  #     over-admit, because the free-slot check, the operator clamp, and the
  #     reconcile all read tenant_active_z truth, never the hint. (Contrast the
  #     2026-05 soft-cap leak: there a derived counter was a HARD GATE, so drift
  #     meant park-storm and stall. A counter that is lethal as a gate is
  #     harmless as an ordering hint.)
  #   - The reconcile runs on ONE pod per interval via a staleness marker (a pod
  #     reconciles only if the last-reconcile marker is older than the
  #     interval), not on all M pods every pass: ~1x not Mx work on the
  #     single-thread Redis, no leader election, and any pod takes over the
  #     instant the marker goes stale.
  #   - Selecting the winning tenant and dispatching its next group is ONE
  #     server-side script round-trip (GC candidates, pick least-in-flight, pop
  #     that tenant's ready group, record the slot), never an N+1 of per-tenant
  #     reads.
  #   - Mapping a chosen tenant to its next ready group is one of two
  #     behaviourally-equivalent implementations, chosen by measured skip-depth
  #     and group-hold-time, NOT fixed by this contract: (A) an additive
  #     per-tenant ready index (O(log n) pop of the tenant's head group) or
  #     (B) scan-and-skip on the single ready zset (pop the global head, admit
  #     if its tenant is the fair winner else skip). Either way the legacy
  #     single-ready keeps being drained continuously-until-empty during the
  #     mixed-fleet rollout (see the upgrade rule), so no group an old pod
  #     enqueues is stranded.
  #   - The reserve is TEMPORAL, not SPATIAL. No slots are ever held empty for a
  #     tenant that has not arrived. A newcomer has zero in-flight, so it is
  #     instantly the least-loaded and wins the next freed slots. Newcomer
  #     latency therefore equals one group-hold-time (slots free only by natural
  #     drain, since dispatch gates rather than preempts). A bounded reserved
  #     floor is added ONLY for the long-hold (evaluation) class, and ONLY if
  #     measured p95 hold-time shows temporal reserve alone starves newcomers.
  #   - Fail PROTECTIVE: any safety fallback (operator clamp default, summary
  #     unavailable) resolves to the low/protective side, never the permissive
  #     side. Stale-permissive would reopen the monopoly we are deleting;
  #     stale-protective is merely slower but stays safe and fair.
  #   - Total queue depth = sum of per-tenant pending (ready + parked +
  #     in-flight), exposed as one shared helper: the dispatcher reads it for
  #     fairness, the queue-depth autoscaler (ADR-021) reads the same primitive
  #     for capacity.

  Background:
    Given the GroupQueue is dispatching across a shared worker fleet

  Rule: Idle capacity is always used (work-conserving)

    Scenario: A single bursty tenant uses all the spare capacity
      Given only one tenant has groups waiting
      And the worker fleet has idle slots
      When dispatch runs
      Then that tenant is dispatched into every idle slot
      And no group of that tenant is parked while a slot sits idle

    Scenario: A tenant past any fair share still dispatches while slots are free
      Given a tenant already holds more in-flight groups than an equal share
      And the fleet still has idle slots
      And no other tenant has work waiting
      When dispatch runs
      Then that tenant keeps being dispatched into the idle slots

    Scenario: A small tenant's unused share is given to a bigger one (max-min)
      Given the fleet is saturated
      And two tenants are competing
      And one tenant has fewer waiting groups than an equal half
      When dispatch runs over time
      Then the smaller tenant gets all of its demand
      And the bigger tenant expands into the half the smaller one does not use
      And no slot is left idle while either has work waiting

  Rule: Fairness engages only under contention (saturation and competing tenants)

    Scenario: Two equally-demanding tenants split a saturated fleet evenly
      Given the fleet is saturated
      And two tenants each have more waiting groups than half the capacity
      When dispatch runs over time
      Then each tenant converges to about half the in-flight slots

    Scenario: A runaway tenant is clamped only to protect a co-waiting tenant
      Given the fleet is saturated
      And one tenant has a very large backlog at the head of the queue
      And a second tenant has a small amount of work waiting
      When dispatch runs
      Then the second tenant is served its fair share promptly
      And the runaway tenant is held to its fair share, not the whole fleet

  Rule: Throttling is released the moment contention ends

    Scenario: A clamped tenant reclaims full capacity when others go idle
      Given a tenant was being held to a fair share under contention
      When the other tenants run out of waiting work
      Then the previously-clamped tenant expands to use all the freed capacity
      And it is never left with idle slots it could fill

  Rule: A newcomer is served as capacity frees, without holding slots idle

    Scenario: A newcomer is served on the next freed slots, not made to wait for a full drain
      Given the fleet is saturated by one incumbent tenant
      When a new tenant arrives with waiting work
      Then the newcomer wins the slots freed by natural drain ahead of the incumbent
      And no slot was held empty in reserve before the newcomer arrived

    Scenario: The long-hold class keeps a bounded floor only when measurement requires it
      Given the reserved floor for the long-hold class is disabled by default
      When measured p95 group-hold-time shows newcomers starve under temporal reserve alone
      And an operator enables the bounded floor
      Then a newcomer is guaranteed the floor of slots within a bounded time
      And the floor is never larger than the measured need

  Rule: A tenant's own work keeps its priority order

    Scenario: Within one tenant, higher-priority groups dispatch first
      Given a tenant has several groups queued at different priorities
      When that tenant is dispatched
      Then its groups are taken in priority order
      And fairness only reorders dispatch across tenants, never within one

  Rule: A tenant leaves and rejoins the rotation cleanly

    Scenario: A tenant drops out of dispatch the moment its work is exhausted
      Given two tenants competing under saturation
      When one tenant's waiting work is fully dispatched
      Then it no longer takes a turn in the rotation
      And the remaining tenant receives the freed capacity
      And a tenant whose work is abandoned by a crash is swept from the rotation

    Scenario: A drifted load summary self-heals and never stalls dispatch
      Given the soft load summary disagrees with the authoritative in-flight truth
      When the periodic reconcile runs
      Then the summary is corrected from the authoritative counts
      And dispatch never stalled or over-admitted while the summary was wrong

  # Escape hatch only. The fair model should never need a hard ceiling, but ops
  # keeps a manual clamp for a pathological tenant. Off by default, and when the
  # clamp state is unavailable it fails to the protective (low) side.
  Rule: An operator can still hard-clamp a pathological tenant

    Scenario: An explicit per-tenant ceiling caps a tenant when set
      Given the emergency hard ceiling is disabled by default
      When an operator sets an explicit ceiling for one tenant
      Then that tenant is held to the ceiling regardless of free capacity
      And no other tenant is affected

  # The change to fair selection touches the hot dispatch path on a live fleet.
  # During the rolling deploy, old pods keep writing groups to the legacy
  # single-ready while new pods select fairly (the same mixed-fleet window the
  # 2026-05 cutover hit), so the carry-over must be continuous-until-drained,
  # not a one-shot backfill.
  Rule: Upgrading the dispatch path loses no in-flight work

    Scenario: Work queued before the upgrade still dispatches after it
      Given groups were queued under the pre-upgrade structure
      When the new dispatcher runs
      Then every previously-queued group is still dispatched
      And none is stranded outside fair selection

    Scenario: Work added to legacy-ready during the rollout is still picked up
      Given the new dispatcher is selecting tenants fairly
      And an old pod is still writing groups to the legacy single-ready
      When the new dispatcher runs repeatedly
      Then it keeps draining the legacy-ready on every pass until empty
      And no group an old pod adds mid-rollout is left stranded
