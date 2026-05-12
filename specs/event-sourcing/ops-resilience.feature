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
  # ops.queues.drainTenant({ queueName, tenantId, groupIdContains? })
  # pages through the ready zset in batches of 1000 via ZSCAN, filters
  # groupIds that start with `<tenantId>/`, and pipelines DRAIN_GROUP_LUA
  # EVALs for that page in a single Redis round-trip.
  #
  # `groupIdContains` is an optional plain-text fragment that the groupId
  # must also contain. Honest substring semantics — what the operator
  # sees in the Groups table is exactly what they match against. The
  # `pipeline name` (e.g. `trace_processing`) is NOT in the groupId
  # (it lives in job data) — we deliberately do not pretend otherwise.
  # Use the groupId-fragment patterns operators actually see:
  #   "/fold/projectDailySdkUsage/" — only this fold's groups
  #   "/reactor/customEvaluationSync/" — only this reactor's groups
  #   "/map/spanStorage/" — only the span-storage map groups
  # No filter = drop everything for that tenant.

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

  @integration @v1 @bulk-drain
  Scenario: drainTenant supports an optional groupIdContains substring filter
    Given tenant A has groups across multiple projections
    When the operator calls drainTenant with groupIdContains="/fold/projectDailySdkUsage/"
    Then only groups whose groupId contains that substring are drained
    And groups in tenant A's other projections are preserved
    And the filter is a plain substring match (no pretense of pipeline-name resolution)
