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
