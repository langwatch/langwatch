# A run that succeeds with a schema step still open leaves the gate behind for good: the worker
# re-runs every 10 s and the api never becomes ready. ARCHITECTURE.md section 7, ADR-173.

Feature: An upgrade never succeeds with a shipped step unfinished
  As an operator of a LangWatch installation
  I want every unfinished blocking step planned and every open schema step to end done
  So that the gate and the planner never disagree about whether the installation is current

  @unit
  Scenario: A release at or below the installed one that left a schema step unfinished is planned again
    Given a succeeded upgrade to 3.23.0 that left 3.22.0's schema step pending
    And the gate reads that ledger as behind
    When the upgrade plans
    Then the plan carries 3.22.0 with that schema step

  @unit
  Scenario: A release at or below the installed one with only a background step open is not planned again
    Given a succeeded upgrade to 3.21.0 whose background step is still pending
    When the upgrade plans
    Then the plan carries no release

  @integration
  Scenario: A run whose schema apply left an open schema step not done fails with schema_failed naming it
    Given an applier that reports success but applies no ClickHouse step
    When the upgrade runs
    Then it exits 1 with schema_failed naming the ClickHouse step
    And no upgrade run is recorded as succeeded
