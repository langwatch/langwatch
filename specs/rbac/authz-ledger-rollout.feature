@authz @grants-ledger
Feature: The authorization ledger and its rollout

  ADR-110. Authorization facts live in an event ledger. A grant is its own
  aggregate; the organization is the tenant on every event and the aggregate
  only for organization-wide facts. One migration turns every legacy table
  into events, the fold builds the projection, and a single cutover fact on
  the organization forks the read path.

  Replaces the three-stage rollout of ADR-092 §13.

  Background:
    Given an organization "org_acme"

  # ═══ The aggregate boundary ═══════════════════════════════════════════

  @unit
  Scenario: A grant's aggregate is the grant
    When a grant is attached for a principal at a scope in "org_acme"
    Then the appended event's aggregate type is "authz_grant"
    And the appended event's aggregate id is the grant id
    And the appended event's tenant is "org_acme"

  @unit
  Scenario: Organization-wide facts stay on the organization aggregate
    When a custom role is defined in "org_acme"
    Then the appended event's aggregate type is "authz_org_policy"
    And the appended event's aggregate id is "org_acme"

  @unit
  Scenario: One command names one aggregate
    When the migration states 462 grants
    Then it sends one attach command per grant
    And no command carries facts for more than one aggregate

  @integration
  Scenario: A grant's fold reads only its own row
    Given an organization holding 70000 grants
    When one further grant is attached
    Then the fold loads a single grant row
    And the work done does not grow with the number of grants the organization holds

  @integration
  Scenario: Grants of one organization fold concurrently
    Given 500 grants attached for "org_acme"
    When the projection drains
    Then the grants fold in parallel rather than in a single per-organization queue
    And events for any one grant are applied in order

  @unit
  Scenario: The fold never deletes a row its own events do not mention
    Given a grant aggregate whose events attach and then revoke it
    When the fold applies them
    Then it writes only that grant's row
    And it removes no row belonging to any other grant

  @integration
  Scenario: Replaying an organization's stream reproduces the same rows
    Given an organization whose grants were written through the ledger
    When its stream is replayed from the beginning
    Then the projection holds exactly the rows it held before

  # ═══ Identity: stable across retries ══════════════════════════════════
  # The event log's sort key is (TenantId, AggregateType, AggregateId,
  # IdempotencyKey). An id minted per attempt lands on a different aggregate,
  # so nothing collapses and every retry adds a duplicate.

  @unit
  Scenario: A migrated grant derives its id from the fact
    Given a legacy role binding row and an organization member floor fact
    When the migration states both as grants
    Then both grant ids are derived from the fact's content
    And no grant id is adopted from the legacy row's id

  @unit
  Scenario: Restating the same fact derives the same aggregate id
    Given a grant fact for a principal at a scope with a fixed business time
    When the id is derived twice in separate processes
    Then both derivations produce the same grant id

  @unit
  Scenario: Re-running the migration appends no second copy of a grant
    Given a pass that already stated 462 grants
    When the migration runs again against the same legacy rows
    Then every restated event carries the aggregate id it carried before
    And the event log holds one row per grant, not two

  @unit
  Scenario: A live write may mint its grant id
    When an operator grants a user access to a project
    Then the grant id is a minted KSUID
    And it is minted once for the action and reused on every retry of it

  @unit
  Scenario: Re-attaching after a revoke is a new aggregate
    Given a grant that was attached and then revoked
    When the same principal is attached at the same scope at a later business time
    Then the derived grant id differs from the revoked grant's id

  @unit
  Scenario: A role keeps its id when it is renamed
    Given a custom role with grants referencing it
    When the role is renamed
    Then the role id is unchanged
    And every grant referencing it still resolves its permissions

  # ═══ One migration ════════════════════════════════════════════════════

  @unit
  Scenario: Every legacy table is a source of events
    Given "org_acme" has organization members, team members, role bindings,
      custom roles and share links
    When the migration runs
    Then each of those rows is stated as an event
    And no legacy row is normalised into another legacy table first

  @unit
  Scenario: The migration states its facts and checks once
    When the migration runs for "org_acme"
    Then it emits every fact as an event
    And it reads the heads once
    And it does not poll waiting for the projection

  @unit
  Scenario: A projection that has not caught up holds the tenant
    Given a pass that has emitted every fact
    When the heads do not yet hold them
    Then "org_acme" is held with the outstanding count in its report
    And no error is logged
    And a later pass revisits it

  @unit
  Scenario: A held tenant names what is outstanding
    Given a pass whose heads are missing facts
    When the tenant is reported
    Then the report names how many facts are outstanding
    And it names a sample of the outstanding fact ids

  @unit
  Scenario: Restating facts is safe because the ledger dedupes them
    Given a pass that failed partway through
    When the migration restates every fact
    Then the facts that already landed append no second event
    And the facts that did not land append normally

  @unit
  Scenario: The organization member floor becomes a grant
    Given "org_acme" has a member holding no binding anywhere
    When the migration runs
    Then that member holds the organization's floor grant
    And gains nothing beyond it

  @unit
  Scenario: A legacy organization admin with no bindings states its access
    Given "org_acme" has an ADMIN membership row whose user holds no binding
    When the migration runs
    Then that user holds an organization-scoped admin grant

  @unit
  Scenario: A grant revoked on the legacy side does not survive a re-run
    Given a grant the migration stated whose legacy row has since been deleted
    When the migration runs again
    Then it sends a revoke command for that grant
    And the revocation is recorded on that grant's aggregate

  @unit
  Scenario: A custom role deleted on the legacy side does not survive a re-run
    Given a role the migration stated whose legacy row has since been deleted
    When the migration runs again
    Then the role is deleted from the projection

  # ═══ The flip ═════════════════════════════════════════════════════════

  @integration
  Scenario: The reads fork on one fact
    Given "org_acme" whose projection agrees with the legacy path
    When the migration records the cutover fact on the organization
    Then permission checks for "org_acme" answer from the ledger
    And checks for an organization without that fact answer from legacy

  @unit
  Scenario: The flip waits for the projection to agree with legacy
    Given "org_acme" whose projection disagrees with the legacy path
    When the migration runs
    Then it records no cutover fact
    And the organization keeps answering from legacy
    And the disagreements are named in its report

  @integration
  Scenario: Nothing legacy changes before the flip
    When the migration runs for "org_acme" and has not yet flipped it
    Then no legacy role binding, custom role or share link row is written
    And the legacy path answers exactly as it did before the migration ran

  @integration
  Scenario: Legacy membership resolves identically either side of the flip
    Given "org_acme" with team, project and organization scoped access
    When the same checks are asked before and after the flip
    Then every answer is the same

  @integration
  Scenario: Rolling back is flipping the fact back
    Given "org_acme" reading from the ledger
    When an operator rolls the cutover back
    Then "org_acme" answers from legacy again
    And the grant events remain, inert until it is flipped again

  @integration
  Scenario: A rollback takes effect without a deploy, even with the queue stopped
    Given "org_acme" reading from the ledger and the queue stopped
    When an operator rolls the cutover back
    Then "org_acme" answers from legacy within the gate's cache window

  @unit
  Scenario: Rolling back an organization that never flipped is refused
    Given "org_acme" has no cutover fact
    When an operator rolls it back
    Then the action is refused

  # ═══ Writes ═══════════════════════════════════════════════════════════

  @integration
  Scenario: A migrated organization's grant write states a fact
    Given "org_acme" reading from the ledger
    When an operator grants a user access
    Then the write appends an event
    And the projection row is written by the fold alone

  @integration
  Scenario: An organization before the flip keeps writing legacy rows
    Given "org_acme" has not been flipped
    When an operator grants a user access
    Then the legacy row is written imperatively
    And the write still records its audit row

  @integration
  Scenario: A migrated organization's grant write refuses while the ledger is unavailable
    Given "org_acme" reading from the ledger and the ledger unavailable
    When an operator grants a user access
    Then the write is refused with a handled error
    And no partial access is left behind

  # ═══ Revocation and offboarding ═══════════════════════════════════════
  # The organization aggregate used to carry this: offboarding swept by
  # principal, so an incomplete list could not leave a member with access.
  # Per-grant aggregates cannot sweep, so the deny is synchronous.

  @unit
  Scenario: A revoke names its grant rather than a selector
    When a caller revokes a principal's access at a scope
    Then it resolves the grant ids first
    And it sends one revoke command per grant id

  @integration
  Scenario: Offboarding ends access before the call returns
    Given a member holding grants across several projects in "org_acme"
    When the member is offboarded
    Then every grant the member holds is denied before the call returns
    And access ends even though the revoke events have not yet folded

  @integration
  Scenario: Offboarding is not defeated by an incomplete list
    Given a member holding a grant the offboarding caller did not enumerate
    When the member is offboarded
    Then that grant is denied too
    And the member holds no access afterwards

  @integration
  Scenario: A revocation never touches a resource outside the caller's project
    Given a share link belonging to another project
    When a caller revokes a resource's links
    Then that link is untouched
    And no fact is appended for it

  @integration
  Scenario: Revocation routing never trusts a cached gate answer
    Given an organization whose cutover state changed since the gate was cached
    When a revocation is routed
    Then it reads the current state rather than the cached answer

  # ═══ Security boundaries ══════════════════════════════════════════════

  @unit
  Scenario: Platform operator access is never a ledger fact
    Given a platform operator acting inside "org_acme"
    When the migration runs
    Then no grant is stated for that operator
    And their access continues to come from the platform role alone

  @unit
  Scenario: Personal workspace teams keep their access team-scoped
    Given "org_acme" has a personal workspace team
    When the migration runs
    Then the stated grants are team-scoped
    And no organization-scoped access is created

  # ═══ API keys ═════════════════════════════════════════════════════════

  @integration
  Scenario: A legacy service key states its access the first time it is used
    Given a service key that predates the ledger
    When it authenticates
    Then its access is stated as a grant
    And the mint never holds up the request that triggered it

  @integration
  Scenario: A key that already states its access mints nothing
    Given a service key whose access is already a grant
    When it authenticates
    Then no further fact is appended

  @integration
  Scenario: A key owned by a user mints nothing it did not already have
    Given a key owned by a user
    When it authenticates
    Then it gains no access the user does not hold

  @integration
  Scenario: A mint that fails leaves the credential working
    Given a service key whose mint fails
    When it authenticates
    Then the request succeeds on the legacy path

  # ═══ The runner ═══════════════════════════════════════════════════════

  @integration
  Scenario: Each organization is claimed by one process at a time
    Given two processes running a pass
    When both reach "org_acme"
    Then one migrates it and the other leaves it alone

  @integration
  Scenario: A pass migrates several organizations at once
    Given several enrolled organizations
    When a pass runs
    Then each is migrated independently
    And one organization's failure does not stop the others

  @unit
  Scenario: An organization that fails mid-migration is parked and retried
    Given a migration that throws for "org_acme"
    When the pass runs
    Then "org_acme" is parked with the error in its report
    And a later pass retries it

  @unit
  Scenario: A finalized organization is never processed again
    Given "org_acme" is finalized
    When a later pass runs
    Then it is skipped

  @unit
  Scenario: A pass already in flight cannot overwrite an operator's rollback
    Given an operator rolled "org_acme" back while a pass held it
    When the pass writes its outcome
    Then the rollback stands

  @integration
  Scenario: A self-hosted installation migrates every organization automatically
    Given a self-hosted installation
    When a pass runs
    Then every organization is migrated without enrollment

  @unit
  Scenario: A migration not yet released for self-hosting never runs there
    Given a migration not released for self-hosting
    When a pass runs on a self-hosted installation
    Then it does not run

  # ═══ Enrollment and pacing ════════════════════════════════════════════

  @unit
  Scenario: Cloud rollout processes only enrolled organizations
    Given "org_acme" is not enrolled
    When a pass runs on cloud
    Then it is skipped

  @unit
  Scenario: Enrolling an organization takes effect on the next pass
    When an operator enrolls "org_acme"
    Then the next pass migrates it

  @unit
  Scenario: Enrolling an organization twice is refused
    Given "org_acme" is enrolled
    When an operator enrolls it again
    Then the action is refused

  @unit
  Scenario: Enrolling an organization that does not exist is refused
    When an operator enrols an unknown organization
    Then the action is refused

  @unit
  Scenario: Enrollment does not apply to self-hosted installations
    Given a self-hosted installation
    When an operator enrols an organization
    Then the action is refused as cloud-only

  @integration
  Scenario: An operator enrols a sampled cohort in one action
    Given a pool of unenrolled organizations
    When an operator enrols a cohort of 10
    Then 10 organizations are enrolled
    And the result names every one it picked

  @integration
  Scenario: A cohort samples only organizations not already enrolled
    Given some organizations are already enrolled
    When an operator enrols a cohort
    Then none of the already-enrolled organizations is picked again

  @integration
  Scenario: A cohort larger than the eligible pool enrols the whole pool
    Given 3 eligible organizations
    When an operator enrols a cohort of 10
    Then all 3 are enrolled

  # ═══ Operator surfaces ════════════════════════════════════════════════

  @integration
  Scenario: The page presents the migration with its title and description
    When an operator opens the migrations page
    Then the migration is listed with what it does for an organization

  @integration
  Scenario: An operator finds an organization by name to act on it
    When an operator searches for "acme"
    Then matching organizations are offered

  @integration
  Scenario: An operator runs the migration for one organization now
    When an operator targets "org_acme"
    Then it is migrated immediately

  @integration
  Scenario: A targeted run for an organization that is not enrolled is refused
    Given "org_acme" is not enrolled
    When an operator targets it
    Then the action is refused

  @integration
  Scenario: A run that flips an organization takes the typed confirmation
    When an operator runs a migration that would flip "org_acme"
    Then a typed confirmation is required first

  # ═══ Audit ════════════════════════════════════════════════════════════

  @integration
  Scenario: A grant a person made is recorded in the audit trail
    When a person grants a user access
    Then an audit row records who did it and what changed

  @unit
  Scenario: The migration's own facts never reach the audit trail
    When the migration states its facts
    Then no audit row is written for them

  @unit
  Scenario: A fact delivered twice writes one audit row
    Given a fact delivered twice
    When the subscriber handles it
    Then exactly one audit row exists
