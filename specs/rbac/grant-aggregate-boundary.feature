@authz @grants-ledger
Feature: A grant aggregate is a grant

  ADR-110. The organization is the TENANT — the isolation and routing boundary
  — but it is no longer the AGGREGATE. A grant is its own aggregate, so an
  organization's fold state stops growing without limit and one organization's
  grants fold concurrently on ADR-100's aggregate-scoped lane.

  Roles, the cutover flag and migration tenant state stay on the organization
  aggregate, because those are the facts that really do carry organization-wide
  invariants.

  Background:
    Given an organization "org_acme"

  # ── The boundary ──────────────────────────────────────────────────────

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
  Scenario: One command names one aggregate
    When the genesis import states 462 grants
    Then it sends one attach command per grant
    And no command carries facts for more than one aggregate

  # ── Identity: the rule is stability across retries ────────────────────
  # Not determinism for its own sake. The event log's sort key is
  # (TenantId, AggregateType, AggregateId, IdempotencyKey), so an id minted
  # freshly per attempt lands on a different aggregate and nothing collapses.

  @unit
  Scenario: An imported grant derives its id from the fact
    Given a legacy role binding row and an organization member floor fact
    When the genesis import states both as grants
    Then both grant ids are derived from the fact's content
    And no grant id is adopted from the legacy row's id

  @unit
  Scenario: Restating the same imported fact derives the same aggregate id
    Given a grant fact for a principal at a scope with a fixed business time
    When the id is derived twice in separate processes
    Then both derivations produce the same grant id

  @unit
  Scenario: Re-running the import appends no second copy of a grant
    Given an import pass that already stated 462 grants
    When the import runs again against the same legacy rows
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

  # ── What the split buys ───────────────────────────────────────────────

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

  # ── What the split must not lose ──────────────────────────────────────
  # The organization aggregate was carrying a safety property: offboarding
  # swept by principal, so an incomplete list could not leave a member with
  # access. Per-grant aggregates cannot sweep, so the guarantee moves to the
  # synchronous projection deny (ADR-092 decision 7).

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

  @unit
  Scenario: A revoke names its grant rather than a selector
    When a caller revokes a principal's access at a scope
    Then it resolves the grant ids first
    And it sends one revoke command per grant id

  # ── The migration: A to B, then one check ─────────────────────────────
  # No convergence polling. The migration cannot write the head — it can only
  # emit — so it states every fact and checks once. An unconverged check is a
  # normal held outcome that the next pass revisits, never an error.

  @unit
  Scenario: The import states every fact and checks once
    Given an organization with legacy roles, bindings and member facts
    When the genesis import runs
    Then it emits every fact as an event
    And it reads the heads once
    And it does not poll waiting for the projection

  @unit
  Scenario: An import whose projection has not caught up is held, not parked
    Given an import that has emitted every fact
    When the heads do not yet hold them
    Then the tenant is reported as migrated with the outstanding count
    And no error is logged
    And the next pass revisits the tenant

  @unit
  Scenario: An import finalizes on the pass that finds the heads complete
    Given an earlier pass that emitted every fact
    When a later pass finds the heads hold all of them and the proof is clean
    Then the tenant is finalized

  @unit
  Scenario: A held tenant names what is outstanding
    Given an import whose heads are missing facts
    When the tenant is reported
    Then the report names how many facts are outstanding
    And it names a sample of the outstanding fact ids

  @unit
  Scenario: Restating facts is safe because the ledger dedupes them
    Given a batch that failed partway through
    When the migration restates the whole batch
    Then the facts that already landed append no second event
    And the facts that did not land append normally
