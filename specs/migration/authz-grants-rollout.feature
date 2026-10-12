# See dev/docs/adr/110-grant-aggregates-are-grants.md
# The authorization behaviour itself lives in specs/rbac/authz-grants.feature.
# Enrollment, cohorts, passes, claims, rollback mechanics and the operator
# surfaces are the generic runner's and live in
# specs/migration/system-migrations-runner.feature.
#
# The ADR-110 one-shot migration is registered
# ([gone] src/server/app-layer/authz/authz-engine.migration.ts); the
# scenarios still tagged @unimplemented are the integration-level ones its
# unit harness cannot honestly bind.

@migration @authz
Feature: Moving an organization onto the grants projection
  As the LangWatch platform
  I want each organization's existing access turned into events once, checked,
  and then read from the projection the moment that check passes
  So that organizations move one at a time with no operator running a script,
  no second step, and no customer noticing

  # ONE migration reads every legacy table, states each row as an event, and
  # proves the projection heads. Runtime authorization always reads current
  # grants; migration status records inventory and proof progress only.

  Background:
    Given an organization "org_acme"

  # ═══ What it reads ════════════════════════════════════════════════════

  @unit
  Scenario Outline: Every legacy table is a source of facts
    Given "org_acme" has <source>
    When the migration runs
    Then that row is stated as <fact>

    Examples:
      | source                        | fact                                |
      | a member with role MEMBER     | an organization-scoped grant        |
      | a member with role ADMIN      | an organization-scoped admin grant  |
      | a member with role EXTERNAL   | a lite-member grant                 |
      | a team membership             | a team-scoped grant                 |
      | a role binding                | a grant at that binding's scope     |
      | a custom role                 | a role definition                   |
      | a share link                  | a resource grant held by anyone     |
      | a project credential          | a project-scoped grant for that key |

  @unit
  Scenario: Team membership is stated directly, not promoted first
    Given "org_acme" has team memberships with no matching role binding
    When the migration runs
    Then each membership is stated as a grant
    And no legacy role binding row is created for it

  @unit
  Scenario: The organization member floor is stated once
    Given "org_acme" has a member holding no binding anywhere
    When the migration runs
    Then that member holds the organization's floor grant
    And gains nothing beyond it

  @unit
  Scenario: An imported grant keeps the time it was originally made
    Given a legacy row created long before the migration
    When it is stated as a fact
    Then the fact carries the row's original time, not the migration's clock

  @unit
  Scenario: Reassigning a grant's role clears the role it was imported with
    Given a grant imported with a legacy role alongside its new custom role
    When the grant is reassigned to a different role
    Then the projected row no longer carries the legacy role it was imported with

  # ═══ How it runs ══════════════════════════════════════════════════════

  @unit
  Scenario: The migration states its facts and checks once
    When the migration runs for "org_acme"
    Then it states every fact
    And it reads the projection once
    And it does not poll waiting for the projection

  @integration
  Scenario: A delayed migration attach cannot cross a membership lifetime
    Given a migration USER fact captured for a current membership
    When its projection arrives after offboarding and rejoining
    Then the old fact is rejected
    And the new membership receives no access from that old fact

  @integration
  Scenario: A disabled membership keeps its migration lifetime
    Given a disabled member with a migration USER fact
    When the fact is projected with the member's lifetime
    Then the Grant is retained for replay
    And runtime access remains denied while the member is disabled

  @unit
  Scenario: A projection that has not caught up holds the organization
    Given a pass that has stated every fact
    When the projection does not yet hold them
    Then "org_acme" is held with the outstanding count in its report
    And no error is logged
    And a later pass revisits it

  @unit
  Scenario: A held organization names what is outstanding
    Given a pass whose projection is missing facts
    When the organization is reported
    Then the report names how many facts are outstanding
    And it names a sample of the outstanding ids

  @unit
  Scenario: Re-running the migration states the same facts
    Given a pass that already ran for "org_acme"
    When it runs again against the same legacy rows
    Then every restated fact carries the id it carried before
    And no second copy of any fact is appended

  # A restated fact dedupes at the event store, but the queue has already paid
  # to carry it. A grant is its own aggregate, so a held organization restaged
  # one group per grant on every worker boot. An organization holding a large
  # share-link population converged on nothing while it repeated them.
  @unit
  Scenario: A pass states only the facts the heads do not carry
    Given an organization whose projection already holds some of its facts
    When a pass runs
    Then a fact the heads carry unchanged is not stated again
    And a fact the heads do not carry is stated
    And a fact whose head is revoked is stated again
    And a fact whose head disagrees on a field is stated again
    And a share link whose head only lags on views is not stated again
    And the first pass over an organization still states everything
    And the held report is unchanged by what the pass skipped

  @unit
  Scenario: A pass that failed partway is safe to repeat
    Given a pass that failed after stating some facts
    When the migration runs again
    Then the facts that landed append nothing
    And the facts that did not land append normally

  @unit
  Scenario: A row deleted on the legacy side is revoked, not left behind
    Given a grant the migration stated whose legacy row has since been deleted
    When the migration runs again
    Then that grant is revoked

  @unit
  Scenario: A custom role deleted before the migration finished stays deleted
    Given a custom role the migration has already deleted
    And the organization no longer has that role
    When the migration runs again
    Then the organization finalizes
    And that role's deletion is not repeated

  @unit
  Scenario: A deleted custom role that exists again is reported, not quietly restored
    Given a custom role the migration has already deleted
    And the organization has that role again under the same id
    When the migration runs again
    Then the organization is held
    And the report names that role as a disagreement
    And the role is not restored automatically

  @unit
  Scenario: A view budget is raised on a re-run, never lowered
    Given a share link whose usage row was seeded on an earlier pass
    When the migration seeds the budgets again
    Then a usage row below the legacy count is raised to it
    And a usage row already at or above it is left exactly as it is
    And a usage row that disagrees about which project it belongs to is untouched

  @unit
  Scenario: A link viewed between passes does not hold the organization
    Given a share link that has been viewed since the last pass
    When the migration runs
    Then the organization is not held for that link

  @integration @unimplemented
  Scenario: The migration is unavailable while the queue is
    Given the queue is unavailable
    When a pass runs for "org_acme"
    Then the organization is parked naming the queue as the cause
    And it is not reported as a projection that is merely behind

  # ═══ Finishing is the switch ══════════════════════════════════════════

  @integration @unimplemented
  Scenario: An organization reads from the projection the moment it finalizes
    Given "org_acme" whose projection agrees with the legacy path
    When the migration finalizes it
    Then permission checks for "org_acme" answer from the projection
    And no separate switch is performed

  @unit
  Scenario: A permission check uses the caller's current grants
    Given "org_acme" has a live grant for the caller
    When a permission is checked
    Then the answer comes from that grant
    And migration status does not select another resolver

  @unit
  Scenario: An authorization write emits a grant command
    Given "org_acme" receives an authorization change
    When the grants service handles the write
    Then it emits a grant command for the current authorization state
    And no legacy write path is selected

  @unit
  Scenario: Completing the authz migration moves an organization's writes onto the ledger
    Given "org_acme" completes the migration
    When the status lookup's cached answer expires
    Then its authorization writes go to the ledger, not the legacy tables

  @unit
  Scenario: The check that precedes finalizing is proven, not assumed
    Given "org_acme" whose projection disagrees with the legacy path
    When the migration runs
    Then it does not finalize
    And the organization keeps answering from legacy
    And the disagreements are named in its report

  @integration @unimplemented
  Scenario: Nothing legacy changes before an organization finalizes
    When the migration runs for "org_acme" and has not finalized it
    Then no legacy role binding, custom role or share link row is written
    And the legacy path answers exactly as it did before

  @unit @unimplemented
  Scenario: There is no cutover flag to disagree with the migration's status
    When the read path is inspected
    Then the organization's migration status is the only fork
    And no separate cutover record exists

  # ═══ Who this migration reaches ═══════════════════════════════════════
  #
  # Every organization, on every installation. The per-organization cloud
  # rollout is finished, and what enrollment would still decide is only
  # whether an organization created SINCE ever migrates - which must not
  # depend on an operator remembering it. So the migration declares itself
  # automatically enrolled and the cohort admits every organization with no
  # row and no operator action. The generic mechanism is
  # specs/migration/system-migrations-runner.feature; what is authz-specific
  # is that this migration is the one that has made the declaration.
  #
  # Self-hosted never had enrollment: a migration either runs for every
  # organization or for none, and which it is comes from the migration's own
  # release declaration. Releasing it is the prerequisite for ever removing
  # the legacy authorization path, because that removal is only safe once
  # every installation that might upgrade into it has already had a release
  # that runs this migration.

  @unit
  Scenario: The migration is released for self-hosted installations
    When the migration's release declaration is read
    Then it runs automatically on a self-hosted installation
    And every organization there migrates without anyone enrolling it

  # A brand-new organization starts with no legacy authorization facts. Its
  # authorization writes use the grants path, while the migration only adopts
  # legacy rows that predate it.
  @unit
  Scenario: The migration reaches every cloud organization without enrollment
    Given a cloud installation
    When the migration's cohort declaration is read
    Then every organization is in its cohort
    And an organization created after the rollout finished migrates on the next pass

  # ═══ Undoing it ═══════════════════════════════════════════════════════
  # The operator action and its mechanics are the runner's. What is authz-
  # specific: rolling back within the gate's cache window is specced in
  # specs/rbac/unified-authorization-engine.feature.

  @unit @unimplemented
  Scenario: Rolling back an organization that never finalized is refused
    Given "org_acme" has never finalized
    When an operator rolls it back
    Then the action is refused
