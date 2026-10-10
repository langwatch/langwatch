Feature: Ops runs the system migration passes and names their cohorts

  @unit
  Scenario: Organization enrollment is what puts a user in the backfill's cohort
    Given one organization enrolled in the identifier backfill and another not
    When the backfill's user cohort is read
    Then exactly the enrolled organization's members are in it
    And a user with no enrolled organization stays out

  @unit
  Scenario: The reconciliation sweep runs on every migration pass
    Given a migration pass
    When it runs
    Then abandoned newborn streams are swept alongside the migrations
    And the pass is still reported when the sweep itself fails

  @unit
  Scenario: The system-migration procedures answer under ops.upgrade and nowhere else
    Given the ten operator-only system-migration procedures
    When the ops tRPC declarations are read
    Then each of the ten sits under ops.upgrade with its original kind and platform permission
    And none of them is declared under ops

  @unit
  Scenario: A migration pass settles the declared tenant steps it drove
    Given a module declares a tenant step and the pass holds one of its tenants
    When the pass runs
    Then the step's ledger row is left pending
    And once a later pass leaves no tenant held, the row is settled

  @unit
  Scenario: The worker's re-drive discovers a tenant migration no pass has run
    Given an installation where no parked or held tenant exists
    And an automatic tenant migration, registered or declared, that no tenant has met yet
    When the worker's hourly re-drive wakes
    Then it runs a pass, so a fresh install or a new release's migration is picked up
    And a declared tenant step with a parked tenant is re-driven beside its finalised ones

  @unit
  Scenario: A latched fleet skips the worker's re-drive
    Given every automatic tenant migration has a finalised or rolled-back tenant
    And no tenant is parked or held
    And a cloud migration still soaking has no enrolled organization
    When the worker's hourly re-drive wakes
    Then no pass runs

  @unit
  Scenario: An organization that finished an ops-held migration does not run it again after its owner declares it
    Given organization "acme" finished the Slack connections migration under ops' legacy name
    And organization "beta" was rolled back from it and organization "gamma" is still held
    When the upgrade runs the blocking step that copies the migration's state to automation's step
    Then "acme" is finalized and "beta" rolled back under automation's step
    And "gamma" has no state under the new step, so the next pass runs it again
    And the legacy rows are left in place, and a second run copies nothing

  @unit
  Scenario: An organization enrolled in an ops-held migration stays enrolled after its owner declares it
    Given organizations "acme" and "delta" are enrolled in the Slack connections migration under ops' legacy name
    And "delta" is already enrolled under automation's step
    When the upgrade runs the blocking step that copies the migration's state to automation's step
    Then "acme" is enrolled under automation's step and "delta" keeps its one enrolment there
    And the legacy enrolments are left in place, and a second run copies nothing

  @unit
  Scenario: Each worker process finishes an interrupted pass on its first re-drive
    Given a pass died part-way, so the stored state reads latched while some tenants have no row
    When a worker process's first hourly re-drive wakes
    Then it runs a pass without asking the stored state
    And its later re-drives ask the stored state first
    And a first pass that fails leaves the next re-drive ungated too

  # The unbatched tRPC link sends no body for a mutation without input, which the door refuses (WEB-9800).
  @unit
  Scenario: An operator's "Run a pass now" is accepted with an empty input
    Given an operator on Ops > Upgrades, Tenant migrations
    When they choose "Run a pass now" and the client sends an empty object
    Then the door accepts it and answers that the pass started
