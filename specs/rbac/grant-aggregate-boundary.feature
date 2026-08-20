@authz @grants-ledger
Feature: A grant aggregate is a grant

  ADR-101. The organization is the TENANT — the isolation and routing
  boundary — but it is no longer the AGGREGATE. A grant is its own aggregate,
  keyed by its own content-derived id, so an organization's fold state stops
  growing without limit and one organization's grants fold concurrently.

  Roles, the cutover flag and migration tenant state stay on the organization
  aggregate, because those are the facts that really do carry organization-wide
  invariants.

  Background:
    Given an organization "org_acme"

  @unit
  Scenario: A grant's aggregate is the grant, not the organization
    When a grant is attached for a principal at a scope in "org_acme"
    Then the appended event's aggregate type is "authz_grant"
    And the appended event's aggregate id is the grant id
    And the appended event's tenant is "org_acme"

  @unit
  Scenario: Role and cutover facts stay on the organization aggregate
    When a custom role is defined in "org_acme"
    Then the appended event's aggregate type is "authz_org_policy"
    And the appended event's aggregate id is "org_acme"

  @unit
  Scenario: One identity rule for every grant, whatever its provenance
    Given a legacy role binding row and an organization member floor fact
    When the genesis import states both as grants
    Then both grant ids are derived from the fact's content
    And no grant id is adopted from the legacy row's id

  @unit
  Scenario: Restating the same fact derives the same aggregate id
    Given a grant fact for a principal at a scope with a fixed business time
    When the id is derived twice in separate processes
    Then both derivations produce the same grant id

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

  @unit
  Scenario: One command names one aggregate
    When the genesis import states 462 grants
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

  @unit
  Scenario: The deny direction revokes explicitly rather than by sweeping
    Given a genesis-imported grant whose legacy row has been deleted
    When the reconciliation pass runs
    Then it sends a revoke command for that grant
    And the revocation is recorded as an event on that grant's aggregate

  @integration
  Scenario: A large organization converges instead of parking
    Given an organization whose import states 69500 resource grants
    When the import runs
    Then the convergence wait observes the outstanding count falling
    And the tenant is not parked while the projection is still draining

  @unit
  Scenario: A parked tenant names what is outstanding
    Given a convergence wait that expires with facts still outstanding
    When the tenant is parked
    Then the report names how many facts are outstanding
    And it names a sample of the outstanding fact ids
    And it states whether the projection was still draining
