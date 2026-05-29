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
  # How fairness is produced (a single scalar cap, recomputed off the hot path):
  #   A water-level W is recomputed on the existing 2s reconcile pass and stored
  #   as one scalar. The unchanged scan-and-park dispatch gate admits a tenant
  #   until its in-flight count reaches W, then parks its excess. W water-fills a
  #   global budget G (the fleet ceiling = pods x concurrency) across the tenants
  #   that currently have demand: a lone tenant gets W=G and bursts to the whole
  #   fleet; two equal tenants converge to G/2 each; a small tenant takes its
  #   full demand and the big tenants split the rest. The split is emergent from
  #   the fill, not a configured 80/20 and not a per-tenant allocation.
  #
  # Implementation invariants (learned from the 2026-05-27/28 incidents):
  #   - No new dispatch structure: reuses the existing scan-and-park gate
  #     (DISPATCH_LUA / DISPATCH_BATCH_LUA), so there is NO mixed-fleet ready
  #     migration. Only the scalar cap changes from a constant to W. Old pods on
  #     the static cap and new pods on W co-exist on the same ready zset.
  #   - W is recomputed on the 2s-gated, single-pod reconcile pass (the
  #     reconcile-ts marker), never per-dispatch. It reads demand_i = in-flight
  #     (tenant_active_z, GC-d) + parked for each tenant in a demand-recency ZSET
  #     (demanding-tenants), avoiding any keyspace SCAN. There is NO per-tenant
  #     load summary and NO argmin: the gate admits in priority order, it does
  #     not select a tenant.
  #   - demanding-tenants is ENQUEUE-populated (recency score = last enqueue), so
  #     a newcomer whose burst is still entirely in ready is counted as a
  #     presence claimant pulling a full share W; without that it would read zero
  #     demand, pin W at the budget, and starve behind a higher-priority
  #     incumbent. Enqueue-only freshness ages a bursted-then-idle tenant out of
  #     the claimant window so it cannot linger as a phantom claim.
  #   - The reserve is TEMPORAL, not SPATIAL: no slot is held empty for a tenant
  #     that has not arrived (W=G when alone). A work-conserving override fills an
  #     otherwise-idle slot from the LEAST-SERVED parked tenant, exceeding W (never
  #     G, bounded by the pod's free slots) so fairness binds only under real
  #     contention. The override's candidate set is the parked tenants only, so a
  #     work-less phantom claim never wins a slot.
  #   - Fail PROTECTIVE: the dynamic-cap key carries a TTL; a stalled recompute
  #     lapses back to the static operator cap (the low side), never permissive.
  #     The whole feature is gated behind LANGWATCH_DISPATCH_GLOBAL_BUDGET (0 =
  #     off, the default), so it ships inert and back-compatible.
  #   - Two distinct reads, do not conflate them: the dispatcher's fairness
  #     demand_i is in-flight + parked per tenant (from tenant_active_z and the
  #     parked set); a ready-only newcomer enters the fill via fresh presence in
  #     demanding-tenants, never via a ready count, so the gate never reads ready
  #     for fairness. The queue-depth autoscaler (ADR-021) reads a separate
  #     primitive: the full pending depth ready + parked + in-flight.

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

  Rule: A tenant leaves and rejoins contention cleanly

    Scenario: A tenant stops competing the moment its work is exhausted
      Given two tenants competing under saturation
      When one tenant's waiting work is fully dispatched
      Then it ages out of the demand set and stops pulling a fair share
      And the remaining tenant expands into the freed capacity
      And a tenant whose in-flight work is abandoned by a crash lapses out of the in-flight truth

    Scenario: A stale dynamic cap fails safe and is rebuilt from truth
      Given the dynamic-cap value has lapsed after a stalled recompute
      When dispatch runs before the next reconcile
      Then it falls back to the static operator cap, never a permissive value
      And the next reconcile rebuilds the water level from the authoritative in-flight and parked counts

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
