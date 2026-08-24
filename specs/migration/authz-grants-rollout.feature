# See dev/docs/adr/110-grant-aggregates-are-grants.md
# The authorization behaviour itself lives in specs/rbac/authz-grants.feature.
# Enrollment, cohorts, passes, claims, rollback mechanics and the operator
# surfaces are the generic runner's and live in
# specs/migration/system-migrations-runner.feature.
#
# The ADR-110 one-shot migration is registered
# (platform/app/src/server/app-layer/authz/authz-engine.migration.ts); the
# scenarios still tagged @unimplemented are the integration-level ones its
# unit harness cannot honestly bind.

@migration @authz
Feature: Moving an organization onto the grants projection
  As the LangWatch platform
  I want each organization's existing access turned into events once, checked,
  and then read from the projection the moment that check passes
  So that organizations move one at a time with no operator running a script,
  no second step, and no customer noticing

  # ONE migration. It reads every legacy table, states each row as an event,
  # and checks. Finishing IS the switch — there is no cutover step, no flag
  # and no gate. An organization whose migration is finalized reads from the
  # projection; one that is not reads from legacy.

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

  # ═══ How it runs ══════════════════════════════════════════════════════

  @unit
  Scenario: The migration states its facts and checks once
    When the migration runs for "org_acme"
    Then it states every fact
    And it reads the projection once
    And it does not poll waiting for the projection

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
  Scenario: An organization that has not finalized reads from legacy
    Given "org_acme" is still in progress
    When a permission is checked
    Then the answer comes from the legacy path

  @unit
  Scenario: An organization that has not completed the genesis import keeps writing legacy rows imperatively
    Given "org_acme" has not completed the genesis import
    When a role binding, custom role or share link is written
    Then the legacy table row is written directly
    And nothing is appended to the ledger

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

  # ═══ Self-hosted installations ════════════════════════════════════════
  #
  # Cloud paces this migration per organization by enrollment. Self-hosted
  # has no enrollment: a migration either runs for every organization or for
  # none, and which it is comes from the migration's own release
  # declaration. Releasing it is the prerequisite for ever removing the
  # legacy authorization path, because that removal is only safe once every
  # installation that might upgrade into it has already had a release that
  # runs this migration.

  @unit
  Scenario: The migration is released for self-hosted installations
    When the migration's release declaration is read
    Then it runs automatically on a self-hosted installation
    And every organization there migrates without anyone enrolling it

  # ═══ Undoing it ═══════════════════════════════════════════════════════
  # The operator action and its mechanics are the runner's. What is authz-
  # specific: rolling back within the gate's cache window is specced in
  # specs/rbac/unified-authorization-engine.feature.

  @unit @unimplemented
  Scenario: Rolling back an organization that never finalized is refused
    Given "org_acme" has never finalized
    When an operator rolls it back
    Then the action is refused
