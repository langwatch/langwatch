Feature: Work-conserving max-min fair dispatch
  As an operator running multi-tenant event-sourcing on a shared worker fleet
  I want a tenant to use as much capacity as is free, and to be throttled only
  when it is actually starving another tenant
  So that spare capacity is never left idle behind a fixed cap, and fairness
  kicks in exactly when, and only when, tenants are competing for scarce slots.

  A water level distributes the configured global budget across tenants with
  current demand. Unused share remains available to tenants that can use it.
  Fairness constrains dispatch only when the fleet is saturated and another
  tenant is waiting.

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

    Scenario: An operator can guarantee newcomers a minimum capacity when long jobs starve them
      Given the newcomer minimum-capacity guarantee is disabled by default
      When monitoring shows newcomers are starved because long-running jobs hold their slots
      And an operator enables the guarantee
      Then a newcomer receives its minimum capacity within a bounded time
      And the guarantee reserves no more capacity than the observed need

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

    Scenario: A tenant whose work is abandoned by a crash is swept from contention
      Given a tenant holds in-flight work while competing for capacity
      When its worker crashes without completing that work
      Then the abandoned slots lapse out of the in-flight truth
      And that tenant no longer pulls a fair share

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
