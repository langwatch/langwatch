# See dev/docs/adr/110-grant-aggregates-are-grants.md
# The authorization behaviour itself lives in specs/rbac/authz-grants.feature

@migration @authz
Feature: Moving an organization onto the grants projection
  As the LangWatch platform
  I want each organization's existing access turned into events once, checked,
  and then switched over by a single recorded fact
  So that organizations move one at a time, at our pace, with no operator
  running a script and no customer noticing

  # ONE migration. It reads every legacy table, states each row as an event,
  # and checks. Rollout state is the migration's own — it is not stored on an
  # authorization aggregate.

  Background:
    Given an organization "org_acme"

  # ═══ What it reads ════════════════════════════════════════════════════

  @unit
  Scenario Outline: Every legacy table is a source of facts
    Given "org_acme" has <source>
    When the migration runs
    Then that row is stated as <fact>

    Examples:
      | source                            | fact                                    |
      | a member with role MEMBER         | an organization-scoped grant            |
      | a member with role ADMIN          | an organization-scoped admin grant      |
      | a member with role EXTERNAL       | a lite-member grant                     |
      | a team membership                 | a team-scoped grant                     |
      | a role binding                    | a grant at that binding's scope         |
      | a custom role                     | a role definition                       |
      | a share link                      | a resource grant held by anyone         |
      | a project credential              | a project-scoped grant for that key     |

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
  Scenario: An organization finalizes on the pass that finds it complete
    Given an earlier pass stated every fact
    When a later pass finds the projection complete and the check clean
    Then "org_acme" is finalized

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

  # ═══ The switch ═══════════════════════════════════════════════════════

  @integration
  Scenario: The reads switch on one recorded fact
    Given "org_acme" whose projection agrees with the legacy path
    When the migration records the switch
    Then permission checks for "org_acme" answer from the projection
    And checks for an organization without that fact answer from legacy

  @unit
  Scenario: The switch waits for the two paths to agree
    Given "org_acme" whose projection disagrees with the legacy path
    When the migration runs
    Then it records no switch
    And the organization keeps answering from legacy
    And the disagreements are named in its report

  @unit
  Scenario: The check that precedes the switch is proven, not assumed
    Given "org_acme" is about to be switched
    When the check runs
    Then the result is recorded before the switch is
    And a switch with no recorded check is refused

  @integration
  Scenario: Nothing legacy changes before the switch
    When the migration runs for "org_acme" and has not switched it
    Then no legacy role binding, custom role or share link row is written
    And the legacy path answers exactly as it did before

  # ═══ Rolling back ═════════════════════════════════════════════════════

  @integration
  Scenario: Rolling back returns an organization to the legacy path
    Given "org_acme" reading from the projection
    When an operator rolls it back
    Then "org_acme" answers from legacy again
    And the grant events remain, inert until it is switched again

  @integration
  Scenario: A rollback applies without a deploy, even with the queue stopped
    Given "org_acme" reading from the projection and the queue stopped
    When an operator rolls it back
    Then the rollback applies within the gate's cache window

  @unit
  Scenario: A rollback is bounded by the gate's cache, not instant
    Given "org_acme" is rolled back
    When a pod holding a cached answer serves a check
    Then it stops honouring the cached answer within the stated window
    And that window is documented rather than discovered

  @unit
  Scenario: Rolling back an organization that never switched is refused
    Given "org_acme" has never been switched
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

  @integration
  Scenario: A self-hosted installation migrates every organization automatically
    Given a self-hosted installation
    When a pass runs
    Then every organization is migrated without enrollment

  @unit
  Scenario: A migration not yet released for self-hosting never runs there
    Given the migration is not released for self-hosting
    When a pass runs on a self-hosted installation
    Then it does not run

  # ═══ Pacing the cloud rollout ═════════════════════════════════════════

  @unit
  Scenario: Cloud rollout processes only enrolled organizations
    Given "org_acme" is not enrolled
    When a pass runs on cloud
    Then it is skipped

  @unit
  Scenario: Enrolling an organization takes effect on the next pass
    When an operator enrols "org_acme"
    Then the next pass migrates it

  @unit
  Scenario Outline: Enrollment refuses what it cannot honour
    When an operator enrols <case>
    Then the action is refused

    Examples:
      | case                                  |
      | an organization already enrolled      |
      | an organization that does not exist   |
      | a migration that does not exist       |
      | any organization on a self-hosted install |

  @integration
  Scenario: An operator enrols a sampled cohort in one action
    Given a pool of unenrolled organizations
    When an operator enrols a cohort of 10
    Then 10 organizations are enrolled
    And the result names every one it picked

  @integration
  Scenario: A cohort never picks an organization twice
    Given some organizations are already enrolled
    When an operator enrols a cohort
    Then none of the already-enrolled organizations is picked again

  @integration
  Scenario: A cohort larger than the pool enrols the whole pool
    Given 3 eligible organizations
    When an operator enrols a cohort of 10
    Then all 3 are enrolled

  # ═══ Operator surfaces ════════════════════════════════════════════════

  @integration
  Scenario: The page presents the migration in the operator's language
    When an operator opens the migrations page
    Then the migration is listed with what it does for an organization

  @integration
  Scenario: An operator finds an organization by name to act on it
    When an operator searches for "acme"
    Then matching organizations are offered

  @integration
  Scenario: An operator runs the migration for one organization now
    Given "org_acme" is enrolled
    When an operator targets it
    Then it is migrated immediately

  @integration
  Scenario: A targeted run for an organization that is not enrolled is refused
    Given "org_acme" is not enrolled
    When an operator targets it
    Then the action is refused

  @integration
  Scenario: A run that would switch an organization takes a typed confirmation
    When an operator runs a migration that would switch "org_acme"
    Then a typed confirmation is required first

  @integration
  Scenario: A run that only waited says so
    Given a targeted run whose organization was already held
    When the run finishes
    Then it reports that it waited
    And it does not report a newly held organization
