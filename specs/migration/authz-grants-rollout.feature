# See dev/docs/adr/110-grant-aggregates-are-grants.md
# The authorization behaviour itself lives in specs/rbac/authz-grants.feature

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

  @integration
  Scenario: The migration is unavailable while the queue is
    Given the queue is unavailable
    When a pass runs for "org_acme"
    Then the organization is parked naming the queue as the cause
    And it is not reported as a projection that is merely behind

  # ═══ Finishing is the switch ══════════════════════════════════════════

  @integration
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
  Scenario: The check that precedes finalizing is proven, not assumed
    Given "org_acme" whose projection disagrees with the legacy path
    When the migration runs
    Then it does not finalize
    And the organization keeps answering from legacy
    And the disagreements are named in its report

  @integration
  Scenario: Nothing legacy changes before an organization finalizes
    When the migration runs for "org_acme" and has not finalized it
    Then no legacy role binding, custom role or share link row is written
    And the legacy path answers exactly as it did before

  @unit
  Scenario: There is no cutover flag to disagree with the migration's status
    When the read path is inspected
    Then the organization's migration status is the only fork
    And no separate cutover record exists

  # ═══ Undoing it ═══════════════════════════════════════════════════════

  @integration
  Scenario: Rolling back moves the status off finalized
    Given "org_acme" reading from the projection
    When an operator rolls it back
    Then "org_acme" answers from legacy again
    And the grant events remain, inert until it finalizes again

  @unit
  Scenario: A rollback applies within the status lookup's cache window
    Given "org_acme" is rolled back
    When a pod holding a cached status serves a check
    Then it stops honouring the cached status within the stated window
    And that window is documented rather than discovered

  @unit
  Scenario: Rolling back an organization that never finalized is refused
    Given "org_acme" has never finalized
    When an operator rolls it back
    Then the action is refused

  @unit
  Scenario: A pass in flight cannot overwrite an operator's rollback
    Given an operator rolled "org_acme" back while a pass held it
    When the pass writes its outcome
    Then the rollback stands

  # ═══ The runner ═══════════════════════════════════════════════════════

  @integration
  Scenario: Each organization is claimed by one process at a time
    Given two processes running a pass
    When both reach "org_acme"
    Then one migrates it and the other leaves it alone

  @integration
  Scenario: One organization's failure does not stop the others
    Given several organizations in a pass
    When the migration throws for one of them
    Then that one is parked
    And the rest are migrated

  @unit
  Scenario: A parked organization is retried on a later pass
    Given "org_acme" was parked
    When a later pass runs
    Then it is attempted again

  @unit
  Scenario: A finalized organization is never processed again
    Given "org_acme" is finalized
    When a later pass runs
    Then it is skipped

  # ═══ Who it runs for ══════════════════════════════════════════════════
  # Enrolled, or on for everyone. No sampling, no cohorts, no pacing ladder.

  @unit
  Scenario: With the migration on, every organization goes through
    Given the migration is on
    When a pass runs
    Then every organization is migrated
    And no enrollment is consulted

  @unit
  Scenario: With the migration off, only enrolled organizations go through
    Given the migration is not on
    And "org_acme" is enrolled
    When a pass runs
    Then "org_acme" is migrated
    And an organization that is not enrolled is skipped

  @unit
  Scenario: Enrolling an organization takes effect on the next pass
    When an operator enrols "org_acme"
    Then the next pass migrates it

  @unit
  Scenario Outline: Enrollment refuses what it cannot honour
    When an operator enrols <case>
    Then the action is refused

    Examples:
      | case                                |
      | an organization already enrolled    |
      | an organization that does not exist |

  @integration
  Scenario: A self-hosted installation migrates every organization
    Given a self-hosted installation
    When a pass runs
    Then every organization is migrated without enrollment

  # ═══ Operator surfaces ════════════════════════════════════════════════

  @integration
  Scenario: The page presents the migration in the operator's language
    When an operator opens the migrations page
    Then the migration is listed with what it does for an organization
    And it shows how many organizations are done, in progress and parked

  @integration
  Scenario: An operator finds an organization by name to act on it
    When an operator searches for "acme"
    Then matching organizations are offered

  @integration
  Scenario: An operator runs the migration for one organization now
    When an operator targets "org_acme"
    Then it is migrated immediately

  @integration
  Scenario: Turning the migration on takes a typed confirmation
    When an operator turns the migration on for everyone
    Then a typed confirmation is required first
