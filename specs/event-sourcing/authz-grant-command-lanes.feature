# See dev/docs/adr/114-grant-command-lanes-and-the-statement-budget.md
#
# ADR-110 made a grant its own AGGREGATE, which fixed the whole-organization
# fold. Because a command's group key defaults to the aggregate id, it also
# gave every grant its own LANE — and because the queue puts the command NAME
# in the job path, `attachGrant` and `revokeGrant` for ONE grant sat in two
# lanes that could drain in either order.
#
# ADR-114 first tried to shard those lanes so a bulk producer's appends would
# coalesce. That made the skew between the two lanes far larger, and the skew
# is not recoverable downstream: `revoked` is a conditional UPDATE, so a revoke
# that arrives before its row exists matches nothing and writes nothing, and
# the late `attached` then inserts a live row no revocation contradicts. The
# amended decision serializes every command about one grant into ONE lane.
#
# The fold is not in scope here and does not change: state is still one grant.
# This file is only about which queue lane a command WAITS in.

@event-sourcing @authz
Feature: Every command about one grant rides one ordered lane
  As the LangWatch platform
  I want the commands that change a single grant to apply to it in the order
  they were issued
  So that a revoke can never be overtaken by the attach it follows and leave
  access live that an operator took away

  # ═══ The lane ═════════════════════════════════════════════════════════

  @unit
  Scenario: Every command about one grant rides one lane
    When the grants pipeline is built
    Then attaching, revoking and role-changing each serialize on the grant
    And none of them declares a lane override the queue would ignore

  @unit
  Scenario: A grant's attach and its revoke share one lane
    Given an attach and a revoke naming the same grant
    When their lanes are derived
    Then both resolve to the same grant
    And the command name does not separate them into two lanes
    And the revoke is handled after the attach it follows

  @unit
  Scenario: Commands about different grants stay independent
    Given commands naming different grants in one organization
    When their lanes are derived
    Then they land in different lanes
    And neither waits on the other

  # ═══ The batching ═════════════════════════════════════════════════════
  #
  # Narrower than it was: a batch now folds ONE grant's own queued
  # same-command jobs, which is safe precisely because they share an
  # aggregate and drain in order. It buys no cross-grant economy and is not
  # meant to — a bulk producer's pressure is answered where it is created
  # (PR #7429, which stopped a pass restating facts the heads already carry),
  # not by weakening the order a grant is applied in.
  @unit
  Scenario: A grant's queued commands fold into one insert
    When the grants pipeline is built
    Then attaching, revoking and role-changing each declare a batch bound
    And the batch bound is a flat number, not a resolver

  @unit
  Scenario: Role commands keep the default lane
    When the grants pipeline is built
    Then defining, changing and deleting a role declare no serialization
    And they declare no batch bound

  # ═══ What must not change ═════════════════════════════════════════════
  #
  # That the fold still keys on the GRANT — the event carries the grant as its
  # aggregate and the organization only as its tenant — is ADR-110's guarantee,
  # not this change's, and it is already covered by "A grant's aggregate is the
  # grant" in specs/rbac/authz-grants.feature. A lane cannot move an aggregate
  # id: the id comes from the command handler and the lane only decides which
  # queue the command waits in. Restating it here would be a second copy of
  # someone else's scenario.
