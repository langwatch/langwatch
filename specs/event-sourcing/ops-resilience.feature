Feature: Tenant-scoped bulk drain (post-2026-05-11 incident)
  As an operator hitting /ops/queues during a tenant-runaway incident
  I want a single action that drains every group for one tenant at once
  So that I do not need to click "Drain" 500K times to mitigate.

  # Why this exists — incident 2026-05-11
  #
  # During the W_7kPya outage the ready zset had 527K groups (~96% for
  # one tenant). The per-group Drain button only operates one group at a
  # time. We had to drop to a shell with port-forwarded Redis and run the
  # DRAIN_GROUP_LUA script in a loop — an action that can't be performed
  # by non-engineers during an outage.
  #
  # ops.queues.drainTenant({ queueName, tenantId }) pages through the
  # ready zset in batches of 1000 via ZSCAN, filters groupIds that start
  # with `<tenantId>/`, and pipelines DRAIN_GROUP_LUA EVALs for that
  # page in a single Redis round-trip. Drains everything for the tenant
  # across every pipeline / projection / reactor — same blast radius as
  # the in-prod shell loop we ran during the incident, just safe and
  # one-click. There is no pipeline scoping: the only realistic use
  # case for this endpoint is "drop everything for this runaway tenant".

  @integration @v1 @bulk-drain
  Scenario: drainTenant bulk-drains all groups for a tenantId
    Given a queue with 100,000 groups for tenant A and 5,000 for tenant B
    When an operator calls ops.queues.drainTenant({ tenantId: "A" })
    Then the endpoint drains tenant A's groups in batches of 1000
    And the response returns total groupsDrained and jobsDrained
    And tenant B's groups are untouched

  @integration @v1 @bulk-drain
  Scenario: drainTenant decrements stats:total-pending atomically per group
    Given a queue with N pending jobs across tenant A's groups
    When drainTenant is called for tenant A
    Then stats:total-pending decreases by N (the staged jobs)
    And if a group also had an active job, total-pending decreases by 1 more
    And total-pending never silently leaks after bulk drain
