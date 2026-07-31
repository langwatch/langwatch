Feature: The ops dashboard reads the lane vocabulary
  As an operator opening /ops during an incident
  I want every figure on the page to come from something the dispatch plane
  actually writes
  So that nothing I read there can be wrong in the direction of "looks fine"

  Context. ADR-108's dispatch plane serialises on LANES, not on queues and
  groups. Depth, lease and park state are lane keys in Redis, so the dashboard
  can read them. Throughput, latency and failure rates are not in Redis at all —
  the plane reports those through its Metrics port, which is a write-only
  counter/histogram contract scraped by Prometheus. The DLQ, the per-pipeline
  and per-tenant pause keys, and the blocked set were removed with the old
  plane; no key renders them.

  A tile that shows 0 for a metric with no substrate is worse than a tile that
  is absent, because an operator will trust it at 3am. So the rule is: read it,
  or do not show it.

  Rule: a lane's status is derived from its own keys

  @unit
  Scenario: A lane whose consumer parked it reads as parked
    Given a lane with a park reason set
    When the console classifies it
    Then it reads as parked
    And the park reason is the failure text shown next to it

  @unit
  Scenario: A parked lane stays parked even while a lease has not expired
    Given a lane with a park reason and a lease that has not expired
    When the console classifies it
    Then it reads as parked rather than leased
    Because a parked lane is the one an operator has to act on

  @unit
  Scenario: A lane held by a live lease reads as leased
    Given an unparked lane whose lease has remaining time
    When the console classifies it
    Then it reads as leased

  @unit
  Scenario: A lane waiting out its retry backoff reads as backing off
    Given an unparked, unleased lane with a ready-at deadline in the future
    When the console classifies it
    Then it reads as backing off

  @unit
  Scenario: A lane with nothing staged reads as idle
    Given an unparked, unleased lane with no pending jobs
    When the console classifies it
    Then it reads as idle rather than as ready work

  Rule: an operator can narrow the listing without leaving the page

  @unit
  Scenario: Searching narrows the listing by lane id
    Given lanes belonging to several tenants
    When the operator types a fragment of one lane id
    Then only the lanes whose id contains that fragment remain

  @unit
  Scenario: Searching matches a park reason
    Given a parked lane whose reason names the failure
    When the operator searches for a word from that reason
    Then the parked lane remains in the listing

  @unit
  Scenario: An exact tenant id unlocks the tenant-wide drain
    Given the operator has typed a bare tenant id into the search box
    When the console resolves the tenant scope
    Then the tenant-wide drain is offered for that tenant

  @unit
  Scenario: A partial or multi-term search does not unlock the tenant-wide drain
    Given the operator has typed a lane-id fragment rather than a bare tenant id
    When the console resolves the tenant scope
    Then no tenant-wide drain is offered
    Because draining every lane of a tenant is unrecoverable

  Rule: the dashboard shows no number it cannot substantiate

  @unit
  Scenario: Every headline tile names a field the snapshot carries
    Given the dashboard snapshot the metrics collector broadcasts
    When the headline tiles are built
    Then each tile reads a field present on that snapshot
    And no tile reports a throughput, latency or dead-letter figure

  @unit
  Scenario: Lane totals come from the collector rather than a client-side sum
    Given a snapshot whose totals disagree with a stale lane-kind breakdown
    When the headline tiles are built
    Then the tiles report the collector's totals

  @unit
  Scenario: Parked lanes are called out only when there are some
    Given a snapshot with no parked lanes
    When the headline tiles are built
    Then the parked tile carries no alarm colour

  @unit
  Scenario: A parked lane raises the alarm colour on its tile
    Given a snapshot with at least one parked lane
    When the headline tiles are built
    Then the parked tile carries the alarm colour

  # Redis saturation tiles keep their own spec — see specs/ops/redis-pressure.feature.
