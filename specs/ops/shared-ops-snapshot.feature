# See dev/docs/adr/090-shared-ops-snapshot-single-writer.md for the
# architectural rationale (single elected writer, two-cadence snapshot,
# why the pod-local scan path is deleted rather than kept as fallback,
# and why a Redis lease is a scoped exception to ADR-052's revision fencing).
#
# "Parked" here always means TENANT SOFT-CAP parking — a group moved out of
# ready into a per-tenant parked set because its tenant is at its in-flight
# cap (specs/event-sourcing/tenant-soft-cap.feature). The poison-group guard's
# "park" is a different thing: it parks a crash-looping group into the BLOCKED
# set (specs/event-sourcing/poison-group-park-guard.feature), where it counts
# toward Blocked, not Parked. The Parked panel shows only the first kind.

Feature: Shared ops snapshot with a single elected writer
  As an operator
  I want every ops dashboard viewer to serve one exhaustively-computed snapshot
  So that the counts, the detail panels, and the chart never tell different stories

  Context: every pod with a Redis connection ran its own collector, scanning the
  GroupQueue keyspace every 2 seconds — ~14 identical scan loops in production.
  Because per-pod-per-2s work had to be cheap, the scan sampled (top/bottom 200
  of each ready zset, 200 random blocked members), so Top Errors could miss
  clusters the exhaustive Blocked card showed on the same screen; parked groups
  were counted but never enumerated anywhere; and each pod kept its own chart
  history and peaks, so two tabs on different pods rendered different charts.
  One lease-elected writer now scans exhaustively and persists a live artifact
  (2s: exact counts, rates, history) and a detail artifact (15s: full blocked
  clustering, parked tenant rows, group rows) that every pod serves read-only.

  Background:
    Given group queues with pending, blocked, and parked groups exist in Redis

  # ── Election ──────────────────────────────────────────────────────────

  @unit
  Scenario: Only the lease holder scans
    Given two ops snapshot writers share one Redis
    And the first writer holds the snapshot lease
    When both writers run a collection cycle
    Then only the first writer scans the queues
    And the second writer performs no scan commands

  @unit
  Scenario: A new writer takes over when the holder stops renewing
    Given a writer holds the snapshot lease and then dies without releasing it
    When the lease TTL elapses
    Then another writer acquires the lease on its next cycle
    And a fresh snapshot is written

  @unit
  Scenario: Graceful shutdown releases the lease immediately
    Given a writer holds the snapshot lease
    When its process shuts down cleanly
    Then the lease is released without waiting for the TTL
    And another writer can acquire it on its next cycle

  @unit
  Scenario: Losing the lease mid-flight does not corrupt the snapshot
    Given a writer's lease expired while its detail scan was still running
    And another writer has since written a newer snapshot
    When the first writer's late write lands
    Then readers still observe a complete, validly-versioned snapshot

  @unit
  Scenario: A writer that lost the lease cannot overwrite its successor
    Given a writer lost the snapshot lease while its scan was in flight
    And the new holder has published a snapshot
    When the departed writer publishes the payload it finished holding
    Then the write is refused
    And the new holder's snapshot is what readers see

  @unit
  Scenario: A scan cannot publish under a lease that turned over beneath it
    Given a writer lost the lease and reacquired it while a scan was running
    When that scan finishes and tries to publish
    Then the write is refused
    And it makes no difference that the same pod holds the lease again

  @unit
  Scenario: A rejected detail write is not adopted as this pod's state
    Given a writer's detail write is refused because the lease turned over
    When the cycle finishes
    Then the writer keeps no detail artifact from that scan
    And it does not report one that no reader can see

  @unit
  Scenario: An older snapshot never replaces a newer one
    Given a writer published a snapshot
    When a slower scan from the same writer finishes with an earlier computed time
    Then its write is refused
    And the newer snapshot stays in place

  # ── The two artifacts ─────────────────────────────────────────────────

  @unit
  Scenario: The live artifact carries exact counts, not sampled ones
    Given a queue whose blocked set is larger than any group-row cap
    When the holder writes the live artifact
    Then the blocked count equals the full cardinality of the blocked set
    And the parked count equals the summed depth of every parked tenant

  @unimplemented
  Scenario: The detail artifact clusters every blocked group
    Given 500 blocked groups across three distinct error messages
    When the holder writes the detail artifact
    Then the error clusters cover all 500 groups
    And the cluster counts sum to the blocked tile's count

  @unimplemented
  Scenario: Parked tenants are enumerated with their oldest waiting group
    Given two tenants are over their in-flight cap with parked groups
    When the holder writes the detail artifact
    Then it contains one row per parked tenant
    And each row carries the tenant, queue, group count, and oldest-parked age

  @unimplemented
  Scenario: A slow detail scan does not stall the live cycle
    Given the exhaustive detail scan takes longer than the live interval
    When live cycles elapse during the scan
    Then the live artifact keeps updating on its own cadence
    And the lease keeps being renewed

  @unit
  Scenario: Bounded sections of the detail artifact are labelled, never silent
    Given more parked tenants than the detail artifact's row cap
    When the holder writes the detail artifact
    Then the parked section reports how many rows were included and how many exist
    And the dashboard renders the shortfall rather than presenting the rows as complete

  # ── Reading ───────────────────────────────────────────────────────────

  @unit
  Scenario: Two reader pods serve identical dashboard data
    Given a holder has written both artifacts
    When two different reader pods build the dashboard payload
    Then both payloads are identical, including chart history and peaks

  @unimplemented
  Scenario: Top Errors and the blocked drill-down agree
    Given the detail artifact contains blocked error clusters
    When the dashboard page and the blocked summary are served
    Then both derive from the same clusters
    And a cluster visible in one is visible in the other

  @unit
  Scenario: Readers surface staleness instead of hiding it
    Given the newest snapshot's computed-at is older than the staleness threshold
    When a reader serves the dashboard
    Then the last snapshot is still served
    And the payload reports how stale it is

  @unit
  Scenario: No snapshot yet renders the loading state, not an error
    Given no snapshot has ever been written
    When a viewer opens the ops dashboard
    Then the dashboard shows the waiting-for-first-collection state

  @unit
  Scenario: A snapshot with an unknown version is treated as absent
    Given the stored snapshot carries a version this reader does not know
    When the reader builds the dashboard payload
    Then the snapshot is ignored as if missing
    And the reader serves the loading state until a known version appears

  @unit
  Scenario: Peaks and chart history survive a writer failover
    Given a holder has accumulated peaks and thirty minutes of history
    When a different writer takes over the lease
    Then the new holder continues from the persisted peaks and history
    And viewers observe no reset in the chart

  @unit
  Scenario: A new writer does not overwrite the fleet's record with its own stale copy
    Given a pod has spent hours losing the lease election
    And its own peaks and history are frozen at its boot
    When it acquires the lease
    Then it reloads the fleet's accumulators before it scans
    And the peak it publishes is the higher of the two, never its own stale one

  # The pending-counter reconcile is NOT governed here. It already has its own
  # cross-instance single-flight marker, specified end to end in
  # specs/ops/pending-counter-reconcile.feature — every pod attempts it, one
  # runs. The snapshot lease does not gate it, and no scenario in this file
  # should imply that it does.

  # ── Drill-down stays live ─────────────────────────────────────────────

  @unimplemented
  Scenario: Expanding a parked tenant lists its groups from live Redis
    Given the detail artifact shows a tenant with parked groups
    When the operator expands that tenant
    Then the parked groups are read from Redis at request time, not from the snapshot

  @unimplemented
  Scenario: Operator actions act on live state, not the snapshot
    Given the snapshot shows a group as blocked
    And the group was unblocked after the snapshot was written
    When the operator runs an unblock action
    Then the action evaluates the group's current state in Redis

  # ── End to end ────────────────────────────────────────────────────────

  @unimplemented
  Scenario: Writer and reader round-trip through a real Redis
    Given a writer and a reader sharing a real Redis instance
    And queues with pending, blocked, and parked groups
    When the writer completes a live cycle and a detail cycle
    Then the reader's dashboard payload reports the exact counts
    And the blocked clusters and parked tenant rows match the queues' state
