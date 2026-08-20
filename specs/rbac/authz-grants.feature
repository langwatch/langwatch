# See dev/docs/adr/110-grant-aggregates-are-grants.md
# Rollout and migration behaviour lives in specs/migration/authz-grants-rollout.feature

@authz @grants
Feature: Authorization grants
  As the LangWatch platform
  I want every access fact stored as an event against the thing it is about,
  and every permission check answered from a projection of those events
  So that access is auditable and replayable without any check ever reading
  the event log

  # Vocabulary, used exactly:
  #   event log   the durable ClickHouse record of what happened
  #   projection  the Postgres tables a check reads (Grant, Role)
  #   pipeline    command -> group queue -> event log + projection
  # There is no "ledger" — the word meant all three at once.

  Background:
    Given an organization "org_acme"

  # ═══ Aggregates ═══════════════════════════════════════════════════════
  # The organization is the TENANT of every event — the isolation and
  # routing boundary. It is the aggregate of nothing: each aggregate is the
  # entity the events are about.

  @unit
  Scenario: A grant's aggregate is the grant
    When a grant is attached for a principal at a scope in "org_acme"
    Then the appended event's aggregate type is "authz_grant"
    And the appended event's aggregate id is the grant id
    And the appended event's tenant is "org_acme"

  @unit
  Scenario: A role's aggregate is the role
    When a custom role is defined in "org_acme"
    Then the appended event's aggregate type is "authz_role"
    And the appended event's aggregate id is the role id
    And the appended event's tenant is "org_acme"

  @unit
  Scenario: No authorization aggregate is keyed by the organization
    When every authorization command type is inspected
    Then none of them derives its aggregate id from the organization
    And rollout state is not stored on an authorization aggregate

  @unit
  Scenario: One command names one aggregate
    When 462 grants are stated
    Then one attach command is sent per grant
    And no command carries facts for more than one aggregate

  @integration
  Scenario: Grants of one organization are written concurrently
    Given 500 grants are attached for "org_acme"
    When the pipeline drains
    Then the grants are processed in parallel rather than one per-organization queue
    And events for any one grant are applied in order

  @integration
  Scenario: One grant's projection write reads only its own row
    Given an organization holding 70000 grants
    When one further grant is attached
    Then a single grant row is written
    And the work done does not grow with the number of grants the organization holds

  # ═══ Identity ═════════════════════════════════════════════════════════
  # The rule is stability across retries, not determinism. The event log
  # sorts by (TenantId, AggregateType, AggregateId, IdempotencyKey), so an id
  # minted per attempt lands on a different aggregate and nothing dedupes.

  @unit
  Scenario Outline: A grant id is stable for the life of the fact it names
    Given a grant that originates from <origin>
    When the same fact is stated twice
    Then both statements carry <id source> as the grant id
    And the second statement appends no second event

    Examples:
      | origin                    | id source                        |
      | a legacy role binding row | the legacy row's own id          |
      | a legacy share link       | the legacy row's own id          |
      | an inferred member floor  | an id derived from the fact      |
      | an operator's live write  | a KSUID minted once per action   |

  @unit
  Scenario: A live write reuses its id when the action is retried
    Given an operator grants a user access and the request times out
    When the client retries the same action
    Then the same grant id is used
    And exactly one grant exists afterwards

  @unit
  Scenario: Re-attaching after a revoke is a new grant
    Given a grant that was attached and then revoked
    When the same principal is attached at the same scope later
    Then the new grant has a different id from the revoked one

  @unit
  Scenario: A role keeps its id when it is renamed
    Given a custom role with grants referencing it
    When the role is renamed
    Then the role id is unchanged
    And every grant referencing it still resolves its permissions

  @unit
  Scenario: A binding id stays the handle a customer already holds
    Given a customer captured a role binding id from the API
    When their organization moves onto the projection
    Then deleting that binding by the captured id still works

  # ═══ The write path ═══════════════════════════════════════════════════

  @unit
  Scenario: Every write goes through the group queue
    When any authorization command is issued
    Then it is enqueued
    And nothing is written to the event log or the projection before it is

  @unit
  Scenario: A projection write never runs inline
    Given the queue is unavailable
    When an authorization command is issued
    Then no fold runs on the calling path
    And the write fails rather than applying partially

  @integration
  Scenario: Attaching a grant while the queue is unavailable fails loudly
    Given the queue is unavailable
    When an operator grants a user access
    Then the request is refused with a handled error
    And no access is granted

  @integration
  Scenario: Revoking while the queue is unavailable still denies
    Given the queue is unavailable
    And a user holds a grant in "org_acme"
    When the grant is revoked
    Then the user is denied before the call returns
    But no revocation event is recorded

  # ═══ Writes that bypass the queue ═════════════════════════════════════
  # Two writes reach the projection directly. Both can only ever make a
  # denial true earlier — neither can grant. They are the only authz writes
  # whose effect may exist without an event behind it.

  @unit
  Scenario Outline: A direct projection write is counted and logged
    When <cause> writes the projection directly
    Then the bypass counter increments with reason <reason>
    And a log line records the organization and the reason

    Examples:
      | cause          | reason     |
      | a revocation   | revocation |
      | an offboarding | offboard   |

  @unit
  Scenario: A direct write can only deny
    When the direct projection write path is inspected
    Then it only ever removes access
    And no path through it grants access

  # ═══ Checking a permission ════════════════════════════════════════════

  @unit
  Scenario: A check reads the projection and never the event log
    When a permission is checked for a member of "org_acme"
    Then the answer comes from the projection
    And the event log is not read

  @unit
  Scenario: Collective principals are expanded at check time
    Given a grant held by a team in "org_acme"
    When a permission is checked for a member of that team
    Then the team's grant applies to them
    And no per-member copy of that grant exists

  @unit
  Scenario: A grant naming a role that has not arrived yet grants nothing
    Given a grant whose role has not been written to the projection
    When a permission is checked for its principal
    Then the permission is denied

  @unit
  Scenario: A projection behind the event log grants less, never more
    Given the projection is missing recent grants
    When permissions are checked
    Then every answer is the same or more restrictive than the truth

  @integration
  Scenario: A check answers the same before and after an organization moves
    Given "org_acme" with team, project and organization scoped access
    When the same checks are asked from each path
    Then every answer is identical

  # ═══ Revocation ═══════════════════════════════════════════════════════

  @unit
  Scenario: A revoke names a principal and scope, not a list of ids
    When a caller revokes a principal's access at a scope
    Then the grants to revoke are resolved by filter
    And the caller does not supply the ids

  @integration
  Scenario: A revoke is not defeated by an incomplete list
    Given a principal holding a grant the caller did not enumerate
    When their access at that scope is revoked
    Then that grant is revoked too

  @integration
  Scenario: A revoked grant is denied before the call returns
    Given a user holding a grant in "org_acme"
    When the grant is revoked
    Then the user is denied immediately
    And the denial does not wait for the queue to drain

  @unit
  Scenario: Applying a revocation twice is harmless
    Given a revocation already applied to the projection
    When the same revocation is applied again
    Then nothing changes and no error is raised

  @integration
  Scenario: A revocation never touches a resource outside the caller's project
    Given a share link belonging to another project
    When a caller revokes a resource's links
    Then that link is untouched
    And no event is appended for it

  @integration
  Scenario: Revocation routing never trusts a cached answer
    Given an organization whose read path changed since the gate was cached
    When a revocation is routed
    Then it reads the current state rather than the cached answer

  # ═══ Offboarding ══════════════════════════════════════════════════════

  @integration
  Scenario: Offboarding ends access before the call returns
    Given a member holding grants across several projects in "org_acme"
    When the member is offboarded
    Then every grant they hold is denied before the call returns

  @integration
  Scenario: Offboarding revokes by principal, not by enumeration
    Given a member holding a grant the offboarding caller did not list
    When the member is offboarded
    Then that grant is denied too
    And the member holds no access afterwards

  @unit
  Scenario: Offboarding records one revocation per grant
    When a member holding 12 grants is offboarded
    Then 12 revocation events are appended
    And each is recorded against its own grant

  # ═══ The projection ═══════════════════════════════════════════════════

  @unit
  Scenario: The projection is written by the pipeline alone
    When application code attempts to write a grant row directly
    Then it cannot
    And the only direct writes are the three deny-only paths

  @unit
  Scenario: A write never removes a row its own events do not name
    Given a grant whose events attach and then revoke it
    When the write is applied
    Then only that grant's row changes
    And no row belonging to any other grant or role is removed

  @unit
  Scenario: A role still referenced by live rows keeps its projection row
    Given a custom role that legacy rows still reference
    When a pass would remove roles no longer stated
    Then that role's row is kept
    And every grant referencing it still resolves its permissions

  @integration
  Scenario: Replaying an organization reproduces the same rows
    Given an organization whose grants were written through the pipeline
    When its events are replayed
    Then the projection holds exactly the rows it held before

  # ═══ Security ═════════════════════════════════════════════════════════

  @unit
  Scenario: A share token is not stored in the projection in the clear
    Given a share link whose token authorizes anonymous reads
    When it becomes a resource grant
    Then the projection stores only a hash of the token
    And a presented token is matched against that hash

  @integration
  Scenario: A replay refuses to run over a gap it cannot account for
    Given revocations were applied directly while the queue was unavailable
    When an operator replays the projection
    Then the replay refuses and names the window
    And access revoked during that window is not restored silently

  @unit
  Scenario: Platform operator access is never a grant
    Given a platform operator acting inside "org_acme"
    When grants are stated for that organization
    Then no grant is created for that operator
    And their access continues to come from the platform role alone

  @unit
  Scenario: Every projection read is scoped to one organization
    When the projection is queried for a permission check
    Then the query names the organization
    And no query can return another organization's grants

  @unit
  Scenario: Personal workspace teams keep their access team-scoped
    Given "org_acme" has a personal workspace team
    When its access is stated
    Then the grants are team-scoped
    And no organization-scoped access is created

  # ═══ Audit ════════════════════════════════════════════════════════════

  @integration
  Scenario: A grant a person made is recorded in the audit trail
    When a person grants a user access
    Then an audit row records who did it and what changed

  @unit
  Scenario: Facts stated by the platform itself never reach the audit trail
    When the platform states grants on its own behalf
    Then no audit row is written for them

  @unit
  Scenario: A fact delivered twice writes one audit row
    Given a fact delivered twice
    When it is handled
    Then exactly one audit row exists
