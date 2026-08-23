# See dev/docs/adr/114-grant-command-lanes-and-the-statement-budget.md
#
# ADR-110 made a grant its own AGGREGATE, which fixed the whole-organization
# fold. Because a command's group key defaults to the aggregate id, it also
# gave every grant its own LANE — a lane of one, which nothing can batch with.
# That is right for interactive access changes and wrong for a bulk producer:
# on 2026-08-23 one migration's 428,720 single-row appends held all 200
# ClickHouse statement slots for ninety minutes, and every pipeline on the
# fleet — customer span ingestion included — queued behind it.
#
# The fold is not in scope here and does not change: state is still one grant.
# This file is only about which queue lane a command WAITS in.

@event-sourcing @authz
Feature: Grant commands share a sharded organization lane
  As the LangWatch platform
  I want a bulk grant producer's appends to coalesce instead of spending one
  ClickHouse statement each
  So that a background import cannot exhaust the statement budget that
  customer-facing work depends on

  # ═══ The lane ═════════════════════════════════════════════════════════

  @unit
  Scenario: Commands about the same grant share a lane
    Given two commands naming the same grant
    When their lanes are derived
    Then both land in the same lane
    And their order relative to each other is preserved

  @unit
  Scenario: Commands about different grants spread across lanes
    Given grant commands for many different grants in one organization
    When their lanes are derived
    Then they are spread across the organization's lanes
    And no lane holds all of them

  @unit
  Scenario: A lane is stable across processes and restarts
    Given a grant id
    When its lane is derived twice
    Then both derivations give the same lane

  @unit
  Scenario: The organization is not repeated in the lane
    Given a grant command for an organization
    When its lane is derived
    Then the lane does not restate the organization
    And the queue key still separates one organization from another

  @unit
  Scenario: Sharding can be turned off
    Given a shard count of one
    When lanes are derived for many grants
    Then every command lands in a single lane per organization

  @unit
  Scenario Outline: A nonsensical shard count falls back to one lane
    Given a shard count of <count>
    When a lane is derived
    Then it does not throw
    And the command lands in the single lane

    Examples:
      | count |
      | 0     |
      | -1    |
      | 1.5   |

  @unit
  Scenario: The shard count is bounded
    Given a shard count above the maximum
    When a lane is derived
    Then the maximum is used instead

  # ═══ The batching ═════════════════════════════════════════════════════

  @unit
  Scenario: The grant commands a bulk producer emits are registered to coalesce
    When the grants pipeline is built
    Then attaching, revoking and role-changing each declare a batch bound
    And each declares the sharded lane

  @unit
  Scenario: Role commands keep the default lane
    When the grants pipeline is built
    Then defining, changing and deleting a role declare no lane override
    And they declare no batch bound

  # A grant command's payload is a handful of ids and never expands after it is
  # dequeued, so the drain's byte budget weighs it honestly and a flat bound is
  # safe — unlike the span case, whose spooled payloads needed a resolver.
  @unit
  Scenario: The batch bound is a flat number, not a resolver
    When the grants pipeline is built
    Then the batch bound is a number

  # ═══ What must not change ═════════════════════════════════════════════
  #
  # That the fold still keys on the GRANT — the event carries the grant as its
  # aggregate and the organization only as its tenant — is ADR-110's guarantee,
  # not this change's, and it is already covered by "A grant's aggregate is the
  # grant" in specs/rbac/authz-grants.feature. A lane cannot move an aggregate
  # id: the id comes from the command handler and the lane only decides which
  # queue the command waits in. Restating it here would be a second copy of
  # someone else's scenario.
