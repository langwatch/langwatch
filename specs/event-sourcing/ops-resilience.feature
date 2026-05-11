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
  # ops.queues.drainTenant({ queueName, tenantId, pipelineFilter? }) pages
  # through the ready zset in batches of 1000, matching groupIds that start
  # with `<tenantId>/`, and drains each via the same atomic Lua script the
  # per-group Drain button uses.

  @integration @v1 @bulk-drain
  Scenario: drainTenant bulk-drains all groups for a tenantId
    Given a queue with 100,000 groups for tenant A and 5,000 for tenant B
    When an operator calls ops.queues.drainTenant({ tenantId: "A" })
    Then the endpoint drains tenant A's groups in batches of 1000
    And the response returns total groupsDrained and jobsDrained
    And tenant B's groups are untouched

  @integration @v1 @bulk-drain
  Scenario: drainTenant supports optional pipeline filter
    Given tenant A has groups in multiple pipelines
    When the operator calls drainTenant with pipelineFilter="trace_processing"
    Then only groups whose pipeline is trace_processing are drained
    And groups in other pipelines for tenant A are preserved
