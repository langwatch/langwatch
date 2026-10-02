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
