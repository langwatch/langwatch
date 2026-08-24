# See dev/docs/adr/110-grant-aggregates-are-grants.md
# Rollout and migration behaviour lives in specs/migration/authz-grants-rollout.feature
#
# Scenarios tagged @unimplemented state designed behaviour no test enforces
# yet. Some of it is already true in code; the tag records that nothing pins
# it, which is the honest reading until a binding exists.

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
  #   compat head the legacy tables (RoleBinding, ShareLink, CustomRole)
  #               kept in step so unmigrated readers keep answering
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
  Scenario: Two grants under one action never collide
    Given one operator action attaches two grants
    When the commands are emitted
    Then each grant is its own aggregate with its own idempotency key
    And neither statement dedupes the other

  @unit @unimplemented
  Scenario: No authorization aggregate is keyed by the organization
    When every authorization command type is inspected
    Then none of them derives its aggregate id from the organization
    And rollout state is not stored on an authorization aggregate

  @unit @unimplemented
  Scenario: One command names one aggregate
    When 462 grants are stated
    Then one attach command is sent per grant
    And no command carries facts for more than one aggregate

  @integration @unimplemented
  Scenario: Grants of one organization are written concurrently
    Given 500 grants are attached for "org_acme"
    When the pipeline drains
    Then the grants are processed in parallel rather than one per-organization queue
    And events for any one grant are applied in order

  @unit
  Scenario: One grant's projection write reads only its own row
    Given an organization holding 70000 grants
    When one further grant is attached
    Then a single grant row is written
    And the work done does not grow with the number of grants the organization holds

  # ═══ Identity ═════════════════════════════════════════════════════════
  # The rule is stability across retries, not determinism. The event log
  # sorts by (TenantId, AggregateType, AggregateId, IdempotencyKey), so an id
  # minted per attempt lands on a different aggregate and nothing dedupes.

  @unit @unimplemented
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

  @unit @unimplemented
  Scenario: A live write reuses its id when the action is retried
    Given an operator grants a user access and the request times out
    When the client retries the same action
    Then the same grant id is used
    And exactly one grant exists afterwards

  @unit @unimplemented
  Scenario: Re-attaching after a revoke is a new grant
    Given a grant that was attached and then revoked
    When the same principal is attached at the same scope later
    Then the new grant has a different id from the revoked one

  @unit @unimplemented
  Scenario: A role keeps its id when it is renamed
    Given a custom role with grants referencing it
    When the role is renamed
    Then the role id is unchanged
    And every grant referencing it still resolves its permissions

  @unit @unimplemented
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

  @unit @unimplemented
  Scenario: A projection write never runs inline
    Given the queue is unavailable
    When an authorization command is issued
    Then no fold runs on the calling path
    And the write fails rather than applying partially

  @unit
  Scenario: Attaching a grant while the queue is unavailable fails loudly
    Given the queue is unavailable
    When an operator grants a user access
    Then the request is refused with a handled error
    And no access is granted

  @integration @unimplemented
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

  @unit @unimplemented
  Scenario Outline: A direct projection write is counted and logged
    When <cause> writes the projection directly
    Then the bypass counter increments with reason <reason>
    And a log line records the organization and the reason

    Examples:
      | cause          | reason     |
      | a revocation   | revocation |
      | an offboarding | offboard   |

  @unit @unimplemented
  Scenario: A direct write can only deny
    When the direct projection write path is inspected
    Then it only ever removes access
    And no path through it grants access

  # ═══ Checking a permission ════════════════════════════════════════════

  @unit @unimplemented
  Scenario: A check reads the projection and never the event log
    When a permission is checked for a member of "org_acme"
    Then the answer comes from the projection
    And the event log is not read

  @unit @unimplemented
  Scenario: Collective principals are expanded at check time
    Given a grant held by a team in "org_acme"
    When a permission is checked for a member of that team
    Then the team's grant applies to them
    And no per-member copy of that grant exists

  @unit @unimplemented
  Scenario: A grant naming a role that has not arrived yet grants nothing
    Given a grant whose role has not been written to the projection
    When a permission is checked for its principal
    Then the permission is denied

  @unit @unimplemented
  Scenario: A projection behind the event log grants less, never more
    Given the projection is missing recent grants
    When permissions are checked
    Then every answer is the same or more restrictive than the truth

  @integration @unimplemented
  Scenario: A check answers the same before and after an organization moves
    Given "org_acme" with team, project and organization scoped access
    When the same checks are asked from each path
    Then every answer is identical

  @unit
  Scenario: The resource-tier collect never pins an organization's head beyond one read
    Given a check that consults resource-tier grants
    When the collect runs
    Then it reads the organization's migration state once
    And every branch of the collect honours that one answer

  # ═══ The read fence ═══════════════════════════════════════════════════
  # Grants are revoked and roles deleted by marking, not deleting. Every
  # access-deciding read therefore filters the marks out, in one place.

  @unit
  Scenario: A revoked grant authorizes nothing
    Given a grant row marked revoked
    When an access-deciding read runs
    Then that row is never returned

  @unit
  Scenario: A deleted role grants nothing
    Given a role row marked deleted
    When an access-deciding read runs
    Then no grant resolves permissions through that role

  @unit
  Scenario: Every access-deciding read goes through the fence
    When the projection's read paths are inspected
    Then each one filters revoked grants and deleted roles
    And the filter lives in one place rather than being repeated

  # ═══ Revocation ═══════════════════════════════════════════════════════

  @unit @unimplemented
  Scenario: A revoke names a principal and scope, not a list of ids
    When a caller revokes a principal's access at a scope
    Then the grants to revoke are resolved by filter
    And the caller does not supply the ids

  @integration @unimplemented
  Scenario: A revoke is not defeated by an incomplete list
    Given a principal holding a grant the caller did not enumerate
    When their access at that scope is revoked
    Then that grant is revoked too

  @integration @unimplemented
  Scenario: A revoked grant is denied before the call returns
    Given a user holding a grant in "org_acme"
    When the grant is revoked
    Then the user is denied immediately
    And the denial does not wait for the queue to drain

  @unit @unimplemented
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

  @integration @unimplemented
  Scenario: Offboarding ends access before the call returns
    Given a member holding grants across several projects in "org_acme"
    When the member is offboarded
    Then every grant they hold is denied before the call returns

  @integration @unimplemented
  Scenario: Offboarding revokes by principal, not by enumeration
    Given a member holding a grant the offboarding caller did not list
    When the member is offboarded
    Then that grant is denied too
    And the member holds no access afterwards

  @unit @unimplemented
  Scenario: Offboarding records one revocation per grant
    When a member holding 12 grants is offboarded
    Then 12 revocation events are appended
    And each is recorded against its own grant

  @unit
  Scenario: Revoking an orphaned group binding runs before the membership edit commits
    Given a membership edit that orphans a group's binding
    When the edit is saved
    Then the orphaned binding's revocation is issued before the edit commits
    And a failure to revoke fails the edit

  # ═══ The projection ═══════════════════════════════════════════════════

  @unit @unimplemented
  Scenario: The projection is written by the pipeline alone
    When application code attempts to write a grant row directly
    Then it cannot
    And the only direct writes are the two deny-only paths

  @unit @unimplemented
  Scenario: A write never removes a row its own events do not name
    Given a grant whose events attach and then revoke it
    When the write is applied
    Then only that grant's row changes
    And no row belonging to any other grant or role is removed

  @unit @unimplemented
  Scenario: A role still referenced by live rows keeps its projection row
    Given a custom role that legacy rows still reference
    When a pass would remove roles no longer stated
    Then that role's row is kept
    And every grant referencing it still resolves its permissions

  @integration @unimplemented
  Scenario: Replaying an organization reproduces the same rows
    Given an organization whose grants were written through the pipeline
    When its events are replayed
    Then the projection holds exactly the rows it held before

  @unit
  Scenario: A redelivered grant event cannot revert a newer one
    Given a grant row written from a newer event
    When an older event for the same grant is delivered again
    Then the row keeps the newer state

  @unit
  Scenario: A grant written to the projection is readable on the legacy head
    Given "org_acme" writes grants through the pipeline
    When a grant lands in the projection
    Then the compat head shows the equivalent legacy row
    And readers of the legacy tables keep answering correctly

  @unit
  Scenario: A revoked grant is gone from the legacy head
    Given a grant with a compat binding on the legacy head
    When the grant is revoked
    Then the compat binding is removed
    And the legacy resolver no longer answers yes to that access

  @unit
  Scenario: A redelivered attach after a revoke leaves no compat binding
    Given a grant that was attached and then revoked
    When an older attach event for it is delivered again
    Then the authoritative row stays revoked
    And the compat binding is not rebuilt from the stale event
    And it is removed rather than resurrected

  @unit
  Scenario: A filtered revoke reaches Grant-head rows with no compat binding
    Given a filtered revoke naming a principal
    And that principal holds a Grant-head row the compat head cannot express
    When the revoke runs on the ledger fork
    Then the revoked set is the union of the compat ids and the Grant ids
    And the row with no compat binding is revoked, not left resolving

  @unit
  Scenario: A filter the vocabulary cannot translate falls back to the compat ids
    Given a filtered revoke whose shape the Grant translation does not cover
    When the revoke runs on the ledger fork
    Then only the compat ids are revoked
    And the Grant head is not queried with a guessed predicate

  # ═══ Share links and the compat heads ═════════════════════════════════
  # Share links live on both heads until every organization has moved:
  # the projection decides, the legacy ShareLink row keeps old readers and
  # old code paths answering.

  @unit
  Scenario: Revoking a link whose grant row has not landed still records the fact
    Given a share link whose projection row has not landed yet
    When the link is revoked
    Then the revocation is recorded anyway
    And the link stops answering on both heads

  @unit
  Scenario: A failed cutover read routes a revocation toward deleting both heads
    Given the organization's migration state cannot be read
    When a share revocation is routed
    Then it deletes from both heads rather than guessing one

  @unit
  Scenario: A resource-wide revoke also names the links only the compat head can see
    Given a resource with links visible only on the compat head
    When the resource's links are revoked
    Then those links are revoked too

  @unit
  Scenario: A consumed view and its compat mirror commit together
    Given a share link viewed for the first time
    When the view is consumed
    Then the projection row and the compat mirror update in one transaction

  @unit
  Scenario: A view that loses the first-view race retries in a fresh transaction
    Given two requests consuming the same first view
    When one loses the race
    Then it retries in a fresh transaction
    And exactly one first view is recorded

  # ═══ Minting from legacy credentials ══════════════════════════════════
  # Legacy API keys carry access no grant states yet. The first authenticated
  # use states it — once, off the request path, and never widening.

  @unit
  Scenario: A legacy service key states its access the first time it is used
    Given a legacy service key holding access no grant states
    When the key authenticates for the first time
    Then its access is stated as grants

  @unit
  Scenario: A key that already states its access mints nothing
    Given a key whose access is already stated
    When it authenticates again
    Then no further grant is stated

  @unit
  Scenario: A key owned by a user mints nothing it did not already have
    Given a key owned by a user
    When its access is stated
    Then the grants never exceed what the key could already do

  @unit
  Scenario: The mint never holds up the request that triggered it
    When a key's first use triggers the mint
    Then the request completes without waiting for it

  @unit
  Scenario: A key that is busy authenticating mints once, not once per request
    Given many concurrent requests with the same key
    When they authenticate together
    Then the key's access is stated exactly once

  @unit
  Scenario: A mint that fails leaves the credential working
    Given the mint fails
    When the key authenticates
    Then the key keeps working exactly as before
    And the mint is retried on a later use

  @unit
  Scenario: A key born during a parked genesis import still mints once the organization migrates
    Given a key created while its organization's import was parked
    When the organization completes the migration
    Then that key's access is stated on its next use

  # ═══ Security ═════════════════════════════════════════════════════════

  @unit @unimplemented
  Scenario: A share token is not stored in the projection in the clear
    Given a share link whose token authorizes anonymous reads
    When it becomes a resource grant
    Then the projection stores only a hash of the token
    And a presented token is matched against that hash

  @integration @unimplemented
  Scenario: A replay refuses to run over a gap it cannot account for
    Given revocations were applied directly while the queue was unavailable
    When an operator replays the projection
    Then the replay refuses and names the window
    And access revoked during that window is not restored silently

  @unit @unimplemented
  Scenario: Platform operator access is never a grant
    Given a platform operator acting inside "org_acme"
    When grants are stated for that organization
    Then no grant is created for that operator
    And their access continues to come from the platform role alone

  @unit @unimplemented
  Scenario: Every projection read is scoped to one organization
    When the projection is queried for a permission check
    Then the query names the organization
    And no query can return another organization's grants

  @unit @unimplemented
  Scenario: Personal workspace teams keep their access team-scoped
    Given "org_acme" has a personal workspace team
    When its access is stated
    Then the grants are team-scoped
    And no organization-scoped access is created

  @unit
  Scenario: The permission vocabulary the UI reads pulls in no server code
    When the browser imports the permission vocabulary
    Then nothing that runs at import time on the server comes with it
    And the client bundle boots

  # ═══ Attribution ══════════════════════════════════════════════════════
  # One actor vocabulary (the package's Actor union): who caused an action is
  # minted at the boundary that authenticated it, and serialized to the
  # ledger record through one seam. No call site builds a "system:..." or
  # "apikey:..." string by hand.

  @unit
  Scenario: Every ledger fact names its actor from one vocabulary
    Given an action attributed to a person, a credential, a named surface, or the platform itself
    When the fact is stamped for the ledger
    Then each actor kind serializes through the one seam
    And no identifier string is assembled at a call site

  @unit
  Scenario: A platform-initiated fact is attributed to the code that made it
    Given the platform acts with no person or credential behind it
    When the fact is stamped
    Then the actor names the code path that decided to act
    And the platform is never an anonymous actor

  # ═══ Provenance ═══════════════════════════════════════════════════════
  # WHERE a grant came from, which the actor cannot say: a directory sync
  # and an approved request to join both act as the platform, and only the
  # source separates them. The vocabulary is closed and shared, so a surface
  # states which one it is rather than inventing a label.

  @unit
  Scenario: A grant states which surface authored it
    Given a surface that grants access on a customer's behalf
    When it states the grant
    Then the fact carries that surface as its source

  @unit
  Scenario: A grant nobody attributed is the grants service's own
    Given a grant made through the ordinary access surfaces
    When no source is stated
    Then the fact is attributed to the grants service

  @unit
  Scenario: The wire accepts every source the vocabulary names
    Given a source is added to the shared vocabulary
    When a grant arrives naming it
    Then the wire accepts it with no second list to edit
    And a source the vocabulary does not name is refused

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
  Scenario: A grant an automated surface made still reaches the audit trail
    Given a surface grants access on a customer's behalf
    When the grant is stated
    Then an audit row records it and names the surface
    And only backdated history is left out

  @unit
  Scenario: A write on the legacy path still records its audit row
    Given "org_acme" has not completed the migration
    When an authorization change is written on the legacy path
    Then an audit row records it just the same

  @unit
  Scenario: A fact delivered twice writes one audit row
    Given a fact delivered twice
    When it is handled
    Then exactly one audit row exists
