Feature: A test suite groups scenarios
  As a person who owns a growing set of agent scenarios
  I want to group my scenarios into named test suites
  So that I can find them, run them together, and archive them together

  Background: what a test suite is.
    A test suite and a run plan are the same kind of record. A test suite
    carries the name a person reads in the rail, the scenarios that belong to
    it, and the run plan that runs those scenarios.

    A scenario belongs to exactly one test suite. A scenario written without one
    named is filed into the project's Default suite, so no scenario is ever
    loose. See specs/suites/default-suite.feature and
    specs/scenarios/scenario-test-suite-assignment.feature.

    Test suites are a v2 surface. The v1 run plan list never shows them. See
    specs/suites/test-suite-run-plan-reuse.feature for the run path and the v1
    guard, and specs/suites/test-suite-membership-invariant.feature for the
    membership rule.

  # --- Creating ---

  @integration
  Scenario: A new test suite is created empty and appears in the rail
    Given a project with no test suites
    When a test suite named "Refunds" is created
    Then "Refunds" is listed in the test suites rail
    And it holds no scenarios
    And it is not rejected for holding no scenarios and no targets

  @integration
  Scenario: A test suite created with a name another suite already uses keeps both names readable
    Given a run plan named "Refunds" already exists
    When a test suite named "Refunds" is created
    Then the test suite is created
    And it reads as "Refunds" in the rail
    And its address differs from the address of the existing run plan

  @unit
  Scenario: A test suite created with a blank name is rejected with validation_error
    When a test suite is created with a name of only spaces
    Then the request is rejected with "validation_error"
    And no test suite is stored

  # --- Renaming ---

  @integration
  Scenario: Renaming a test suite keeps its scenarios and its run history
    Given a test suite "Refunds" holding three scenarios and one finished run
    When the test suite is renamed to "Refunds and credits"
    Then the rail reads "Refunds and credits"
    And the same three scenarios are still in it
    And the finished run is still listed under it

  @integration
  Scenario: Renaming a test suite in another project is refused with suite_not_found
    Given a test suite that belongs to another project
    When a rename of that test suite is requested
    Then the request is refused with "suite_not_found"
    And the test suite keeps its name

  # --- Archiving ---

  @integration
  Scenario: Archiving a test suite archives the scenarios in it
    Given a test suite "Refunds" holding two active scenarios
    When the test suite is archived
    Then the test suite is gone from the test suites rail
    And both scenarios are gone from the scenario list
    And neither scenario is listed as unfiled

  @integration
  Scenario: Archiving a test suite archives its run plan too
    Given a test suite "Refunds" with a run plan that has run before
    When the test suite is archived
    Then the run plan is gone from the Test Runs list
    And the runs it produced are still readable in the results view

  @integration
  Scenario: The archive dialog names the test suite and says what happens to its scenarios
    Given a test suite "Refunds" holding two scenarios
    When Archive suite is chosen from the test suite menu
    Then the dialog names "Refunds"
    And the dialog says the scenarios in it are archived as well
    And leaving the dialog without confirming archives nothing

  @integration
  Scenario: Archiving a test suite that is already archived changes nothing
    Given an archived test suite "Refunds"
    When the test suite is archived again
    Then the request succeeds
    And the time it was first archived is unchanged

  # --- Scenario membership ---

  @unit
  Scenario: A test suite reads back with the scenarios filed in it
    Given a test suite holding two active scenarios and one archived scenario
    When the test suite is read for its detail view
    Then the test suite row comes back with the name of each active scenario
    And the archived scenario is left out

  @unit
  Scenario: A scenario belongs to exactly one test suite
    Given a scenario in the test suite "Refunds"
    When the scenario is moved to the test suite "Checkout"
    Then the scenario is in "Checkout" only
    And "Refunds" no longer holds it

  @integration
  Scenario: A scenario cannot be filed into a run plan that is not a test suite
    Given a run plan "Nightly"
    When a scenario is moved into "Nightly"
    Then the request is refused with "scenario_test_suite_not_found"
    And the scenario keeps the test suite it had

  @integration
  Scenario: A refused move leaves the scenario in the test suite it was in
    Given an archived test suite "Refunds"
    When a scenario is moved into "Refunds"
    Then the request is refused with "scenario_test_suite_not_found"
    And the scenario is still in the test suite it was in

  # --- What the store calls it ---

  # The stored words follow the product words: a scenario names its test suite
  # in "Scenario"."testSuiteId", a suite row holds the kind "test_suite" or
  # "run_plan", and a plan scope holds the mode "test_suites" or "scenarios".

  @integration
  Scenario: The scenario column names the test suite it is filed in
    When the stored shape of a scenario is read
    Then it carries a test suite column named testSuiteId
    And the index over the project and that column follows the column name

  @integration
  Scenario: The stored suite kinds are test_suite and run_plan
    Given suite rows stored under the old kinds
    When the migration runs
    Then a test suite row reads as "test_suite"
    And a run plan row reads as "run_plan"
    And a suite row written with no kind reads as "run_plan"

  @integration
  Scenario: The stored scope modes are test_suites and scenarios
    Given a plan scoped to test suites and a plan that runs its own list
    When the migration runs
    Then the first plan reads mode "test_suites" with its ids under testSuiteIds
    And the second plan reads mode "scenarios"
    And a plan with no scope is left as it is

  # --- Permissions ---

  @integration
  Scenario: A viewer can read test suites but cannot create or archive one
    Given a person with read-only access to the project
    When they open the test suites rail
    Then they see every test suite in the project
    But creating a test suite is refused with "insufficient_permissions"
    And archiving a test suite is refused with "insufficient_permissions"

  # --- What the test suite editor may save ---

  @unit
  Scenario: The suite editor refuses execution settings on a test suite
    Given a test suite in the project
    When the suite editor saves a name and labels
    Then the test suite shows the saved values on the next read
    And the test suite keeps its address the person opened it under
    When the suite editor saves targets, a repeat count or a model override
    Then the change is refused with "validation_error"
    And the refusal names every execution field the request carried

    A test suite holds what it collects, never how a run of it is executed. The
    targets, the repeat count and the models travel with each run and are
    written onto the run plan that run resolves. See
    specs/suites/test-suite-run-plan-reuse.feature.

  @unit
  Scenario: The suite editor refuses to broaden a test suite into a code-owned suite
    Given a test suite in the project
    When the suite editor tries to change what the test suite collects to a plain rule
    Then the change is refused with "suite_scope_not_allowed"
    When the suite editor tries to name the scenarios directly
    Then the change is refused with "validation_error"
