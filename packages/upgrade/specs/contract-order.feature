# Nothing is deleted automatically, and every step runs after old writers are gone (Alex,
# 2026-10-11). The upgrade runs schema and blocking steps only: a background step runs on the
# worker once old writers are gone, and a drop is an operator step an operator confirms in Ops once
# it is safe. This replaced running background steps inline before a contract (UPGRADE-FIXES,
# STEP-AFTER-2), which ran them while old pods could still serve. A background step may run `after`
# other background steps, named by their step values (Alex, 2026-10-09, STEP-AFTER), so a mistyped
# id fails typecheck and the planner refuses an unknown id or a cycle.

Feature: The upgrade never runs a background or operator step
  As an operator of a LangWatch installation
  I want the upgrade to leave background steps to the worker and drops to me
  So that no upgrade deletes data, or moves it while old writers still serve

  @integration
  Scenario: An upgrade never runs a background step, even before a later release's schema
    Given 3.20.1 is installed and 3.21.0 ships a background step that waits for old writers
    And 3.22.0 ships more schema
    When the upgrade jumps to 3.22.0
    Then it applies 3.21.0's schema, then 3.22.0's, and the background step stays pending for the worker

  @integration
  Scenario: An operator step is registered pending and the upgrade never runs it
    Given 3.21.0 ships an operator step that drops a retired column
    When the upgrade jumps from 3.20.1 to 3.22.0
    Then the operator step is recorded pending and its code never runs

  @unit
  Scenario: A step that runs after an unknown step is refused at plan time
    Given a background step that runs after a step the image does not declare and the ledger has not settled
    When the upgrade is planned
    Then it is refused as step_after_unknown, naming both steps

  @unit
  Scenario: Steps that run after each other in a cycle are refused at plan time
    Given two background steps that each run after the other
    When the upgrade is planned
    Then it is refused as step_after_cycle, naming the cycle

  @unit
  Scenario: A step names the steps it runs after by their values and keeps their ids
    Given a background step declared to run after another step value
    When it is defined
    Then it keeps the named step's id

  @unit
  Scenario: A step names another module's step by its generated id
    Given a background step that runs after a step id in the image's generated code step ids
    When it is defined
    Then it keeps the id

  @unit
  Scenario: A step named by a mistyped id fails typecheck
    Given a background step that names the step it runs after by an id the image does not collect
    When the package is typechecked
    Then the declaration is a type error

  @unit
  Scenario: Only a background step runs after others, and only after background steps
    Given a blocking step declared to run after a background step
    When it is defined
    Then it is refused as after_not_background

  @unit
  Scenario: A worker holds a background step until every step it runs after is done
    Given a pending background step that runs after a step still running
    When the worker sweeps
    Then it reports the step waiting and runs nothing
