# The generic system-migrations runner: cohorts, enrollment, passes, claims,
# rollback and the operator surfaces. What any one migration does when it runs
# lives in that migration's own spec — for the authz migration,
# specs/migration/authz-grants-rollout.feature.

@migration @runner
Feature: Running system migrations across organizations
  As a LangWatch operator
  I want migrations to run organization by organization, paced while a rollout
  is happening and automatic once it is finished, claimed by one process at a
  time and reversible without a deploy
  So that a platform-wide change lands gradually, reaches every organization
  in the end including the ones created since, and any organization can be
  taken back off it the moment something looks wrong

  Background:
    Given a registered system migration
    And an organization "org_acme"

  # ═══ Passes and claims ════════════════════════════════════════════════

  @unit
  Scenario: A pass migrates several organizations at once
    Given several organizations awaiting migration
    When a pass runs
    Then more than one organization is migrated in the same pass

  @integration
  Scenario: Each organization is claimed by one process at a time
    Given two processes running a pass
    When both reach "org_acme"
    Then one migrates it and the other leaves it alone

  @unit
  Scenario: The pass keeps its claim while one large organization migrates
    Given "org_acme" takes longer to migrate than the claim's lease
    When the pass is still working on it
    Then the claim is renewed rather than expiring mid-migration

  @unit
  Scenario: An organization that fails mid-migration is parked and retried
    Given the migration throws for "org_acme"
    When the pass finishes
    Then "org_acme" is parked rather than failing the pass
    And a later pass attempts it again

  @unit
  Scenario: A finalized organization is never processed again
    Given "org_acme" is finalized
    When a later pass runs
    Then it is skipped

  # ═══ Automatic enrollment ═════════════════════════════════════════════
  # Enrollment paces a rollout while it is happening. A finished rollout has
  # the opposite problem: every organization created since must migrate too,
  # and nothing should depend on an operator remembering to enroll it. A
  # migration says which of the two it is, once, in its own declaration — so
  # a migration mid-rollout and a migration that has finished one can coexist
  # on the same installation.

  @unit
  Scenario: A migration can declare that every organization is in its cohort
    Given a cloud installation
    And a migration declared enrolled automatically
    When a pass computes its cohort
    Then an organization nobody enrolled is in it

  @unit
  Scenario: An organization nobody enrolled migrates for an automatically enrolled migration
    Given a cloud installation
    And a migration declared enrolled automatically
    And an organization created after the rollout finished
    When a pass runs
    Then that organization is migrated

  # The one class no cohort draw has ever included. Their events belong on
  # their own instance, and a declaration is not the place to change that.
  @unit
  Scenario: An automatic cohort leaves out a private-dataplane organization
    Given a migration declared enrolled automatically
    And an organization with a dedicated data plane exists
    When a pass runs
    Then that organization is left alone with no state recorded

  @unit
  Scenario: An operator can still enroll a private-dataplane organization by name
    Given a migration declared enrolled automatically
    And an operator has enrolled an organization with a dedicated data plane
    When a pass runs
    Then that organization is migrated

  @unit
  Scenario: Enrolling an organization for an automatically enrolled migration is refused
    Given a migration declared enrolled automatically
    When an operator enrols an organization for it
    Then the action is refused
    And no enrollment row is written

  @unit
  Scenario: Withdrawing from an automatically enrolled migration is refused
    Given a migration declared enrolled automatically
    When an operator withdraws an organization from it
    Then the action is refused
    And nothing is paused

  @unit
  Scenario: A targeted run needs no enrollment for an automatically enrolled migration
    Given a migration declared enrolled automatically
    And an organization no enrollment row names
    When an operator targets it
    Then the migration runs for that organization

  @unit
  Scenario: The migrations page is told there is nothing to enroll
    Given a migration declared enrolled automatically
    When the migrations page reads that migration
    Then it is told every organization runs it
    And it is offered no enrollment count

  # ═══ Enrollment ═══════════════════════════════════════════════════════
  # What paces a migration that has not declared itself automatic.

  @unit
  Scenario: Enrollment alone decides which organizations migrate
    Given "org_acme" is enrolled and another organization is not
    When a pass runs
    Then "org_acme" is migrated and the other is left alone

  @unit
  Scenario: Cloud rollout processes only enrolled organizations
    Given a cloud installation
    When a pass runs
    Then only enrolled organizations are attempted

  @unit
  Scenario: Enrolling an organization takes effect on the next pass
    When an operator enrols "org_acme"
    Then the next pass migrates it

  @unit
  Scenario: Each migration is enrolled separately and paces independently
    Given two registered migrations
    When "org_acme" is enrolled for one of them
    Then only that migration processes it
    And the other migration's pacing is unaffected

  @unit
  Scenario: Enrolling an organization twice is refused
    Given "org_acme" is already enrolled
    When an operator enrols it again
    Then the action is refused

  @unit
  Scenario: Enrolling an organization that does not exist is refused
    When an operator enrols an organization id that matches nothing
    Then the action is refused

  @unit
  Scenario: Enrolling for a migration that does not exist is refused
    When an operator enrols "org_acme" for an unregistered migration
    Then the action is refused

  @unit
  Scenario: Withdrawing an organization that is not enrolled is refused
    Given "org_acme" is not enrolled
    When an operator withdraws it
    Then the action is refused

  # ═══ Cohorts ══════════════════════════════════════════════════════════

  @unit
  Scenario: An operator enrolls a sampled cohort in one action
    When an operator asks for a cohort of a given size
    Then that many eligible organizations are enrolled in one action

  @unit
  Scenario: A cohort samples only organizations not already enrolled
    Given some organizations are already enrolled
    When a cohort is sampled
    Then none of the already-enrolled organizations are drawn again

  @unit
  Scenario: A cohort leaves out an enterprise organization by default
    Given an enterprise organization exists
    When a cohort is sampled
    Then the enterprise organization is not drawn

  @unit
  Scenario: A cohort leaves out a private-dataplane organization by default
    Given an organization with a dedicated data plane exists
    When a cohort is sampled
    Then that organization is not drawn

  # Finishing a proven rollout means taking the held-back organizations over
  # too, and the single-organization enroll never applied either exclusion —
  # so the only thing the default was buying was an operator enrolling them
  # one id at a time.
  @unit
  Scenario: An operator can draw enterprise organizations into a cohort
    Given an enterprise organization exists
    When a cohort is sampled with enterprise organizations included
    Then the enterprise organization can be drawn

  @unit
  Scenario: An operator can draw private-dataplane organizations into a cohort
    Given an organization with a dedicated data plane exists
    When a cohort is sampled with dedicated-data-plane organizations included
    Then that organization can be drawn

  # Two switches, not one: an enterprise organization is a commercial risk and
  # a private-dataplane organization keeps its events in a ClickHouse instance
  # of its own. Lifting one must never lift the other.
  @unit
  Scenario: Including one held-back class does not include the other
    Given an enterprise organization and a dedicated-data-plane organization exist
    When a cohort is sampled with only enterprise organizations included
    Then the enterprise organization can be drawn
    And the dedicated-data-plane organization is not drawn

  @unit
  Scenario: A widened cohort says so in the audit trail
    When a cohort is sampled with a held-back class included
    Then each enrolled organization's audit row records which classes were included

  @unit
  Scenario: A later step's cohort samples only organizations enrolled for the step before it
    Given a migration with ordered steps
    When a cohort is sampled for a later step
    Then only organizations enrolled for the preceding step are drawn

  @unit
  Scenario: A cohort larger than the eligible pool enrolls the whole pool
    Given fewer eligible organizations than the requested cohort size
    When the cohort is sampled
    Then every eligible organization is enrolled
    And the action does not fail

  @integration
  Scenario: A cutover cohort takes the typed confirmation
    When an operator enrolls a cutover cohort
    Then a typed confirmation is required first

  # ═══ Self-hosted installations ════════════════════════════════════════
  # Cloud decides WHO by the migration's cohort; self-hosted decides WHETHER
  # by the migration declaring itself released for self-hosting. Two axes,
  # two declarations, and self-hosted never reads the cohort one.

  @unit
  Scenario: Enrollment does not apply to self-hosted installations
    Given a self-hosted installation
    When a pass runs
    Then organizations are processed without consulting enrollment

  @unit
  Scenario: Cohort enrollment does not apply to self-hosted installations
    Given a self-hosted installation
    When a cohort enrollment is attempted
    Then it is refused

  @integration
  Scenario: A self-hosted installation migrates every organization
    Given a self-hosted installation
    When a pass runs
    Then every organization is migrated without enrollment

  @unit
  Scenario: A migration not yet released for self-hosting never runs there
    Given a self-hosted installation
    And a migration not declared released for self-hosting
    When a pass runs
    Then that migration processes nothing

  @unit
  Scenario: A release that turns a migration on for self-hosting makes it run on the next pass
    Given a self-hosted installation
    When a release declares the migration released for self-hosting
    Then the next pass runs it

  @unit
  Scenario: Cloud rollout is unaffected by the self-hosted release declaration
    Given a cloud installation
    And a migration not declared released for self-hosting
    When a pass runs
    Then the organizations in its cohort are still processed

  @unit
  Scenario: Self-hosted installations run the preparation work but not the cutover yet
    Given a self-hosted installation
    When a pass runs
    Then the migration's preparation work runs
    And no organization is cut over

  # ═══ Rollback ═════════════════════════════════════════════════════════

  @unit
  Scenario: An operator rolls a finalized organization back to its legacy path
    Given "org_acme" is finalized
    When an operator rolls it back
    Then "org_acme" answers from its legacy path again

  @unit
  Scenario: An operator rolls a migrated organization back to its legacy path
    Given "org_acme" is migrated
    When an operator rolls it back
    Then "org_acme" answers from its legacy path again

  @unit
  Scenario: Rolling back a cutover takes effect without a deploy, even with the queue stopped
    Given the queue is stopped
    When an operator rolls "org_acme" back
    Then the rollback lands immediately
    And no deploy or restart is needed

  @unit
  Scenario: A pass in flight cannot overwrite an operator's rollback
    Given an operator rolled "org_acme" back while a pass held it
    When the pass writes its outcome
    Then the rollback stands

  # ═══ Operator surfaces ════════════════════════════════════════════════

  @unit
  Scenario: Each migration presents a title and a description, in running order
    When an operator opens the migrations page
    Then every registered migration is listed with a title and a description
    And they appear in the order they run

  @unit
  Scenario: The page shows how many organizations each migration could still enroll
    When an operator opens the migrations page
    Then each migration shows how many eligible organizations remain

  @integration
  Scenario: An operator finds an organization by name to act on it
    When an operator searches for "acme"
    Then matching organizations are offered

  @integration
  Scenario: An operator runs the migration for one organization now
    When an operator targets "org_acme"
    Then it is migrated immediately

  @integration
  Scenario: A targeted cutover run takes the typed confirmation
    When an operator targets "org_acme" for a cutover
    Then a typed confirmation is required first

  @unit
  Scenario: A targeted run for an organization that is not enrolled is refused
    Given "org_acme" is not enrolled
    When an operator targets it
    Then the action is refused

  @unit
  Scenario: A targeted run while a pass is already running is refused
    Given a pass is already running
    When an operator targets "org_acme"
    Then the action is refused

  @unit
  Scenario: One contended member does not discard a user-rooted run's outcome
    Given a user-rooted migration whose tenants are "org_acme"'s members
    And one member is claimed by another pass while the rest finalize
    When an operator targets "org_acme"
    Then the run reports the organization rather than refusing outright
    And the contended member keeps the organization on the operator's list

  @unit
  Scenario: A targeted run that only waited says so, rather than reporting a held organization
    Given a targeted run that spent its time waiting on a claim
    When the run reports
    Then it says it waited
    And it does not report "org_acme" as held
