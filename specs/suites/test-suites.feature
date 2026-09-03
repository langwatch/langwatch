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

  # --- Fields on a test suite ---

  # A test suite declares typed fields beyond situation and criteria, and every
  # scenario filed in it carries one value per field. The identifier grammar
  # and the value rules are in specs/scenarios/scenario-fields.feature.

  @integration
  Scenario: A test suite declares fields and reads them back
    Given a test suite "Case lookups"
    When the suite editor saves the fields golden_sql (text) and table_schema (text)
    Then the test suite reads back with both fields in that order
    And the public API returns the same fields on the test suite

  @integration
  Scenario: A field an evaluator reads cannot be removed
    Given a test suite declaring the field golden_sql
    And an evaluator attached to it with expected_output mapped to that field
    When the suite editor saves the fields without golden_sql
    Then the change is refused with "suite_field_in_use"
    And the test suite keeps its fields and its evaluators

  @unit
  Scenario: A run plan takes evaluators but no fields
    Given a run plan "Nightly"
    When fields are written on it
    Then the change is refused with "validation_error"

  # --- Evaluators on a test suite ---

  # An evaluator attached to a suite runs after every scenario run of that
  # suite. Each of its inputs maps to a source: the conversation, the scenario
  # (situation, criteria or a field) or the trace (retrieved contexts, or a
  # tool call's input or output). A required evaluator that fails fails the
  # scenario; a score-only evaluator reports and never gates.

  @integration
  Scenario: An evaluator is attached to a test suite with its mappings
    Given a test suite declaring the field golden_sql
    And a saved evaluator "SQL Query Equivalence" with inputs output, expected_output and expected_contexts
    When the suite editor attaches it, required, with output from the last agent message and expected_output from golden_sql
    Then the test suite reads back with the attachment and its mappings
    And the public API returns the same evaluators on the test suite

  @integration
  Scenario: An attachment naming an evaluator the project does not have is refused
    Given a test suite
    When the suite editor attaches an evaluator id that names nothing in the project
    Then the change is refused with "suite_evaluator_not_found"

  @unit
  Scenario: A mapping to a field the suite does not declare is refused
    Given a test suite declaring the field golden_sql
    When an attachment maps expected_output to the scenario field table_schema
    Then the change is refused with "suite_evaluator_mapping_invalid"

  @unit
  Scenario: A mapping to a path no source has is refused
    Given a test suite
    When an attachment maps output to conversation.final_answer
    Then the change is refused with "suite_evaluator_mapping_invalid"

  @unit
  Scenario: A run plan evaluator cannot read a scenario field
    Given a run plan "Nightly"
    When an evaluator attached to it maps expected_output to a scenario field
    Then the change is refused with "suite_evaluator_mapping_invalid"

  @unit
  Scenario: Mappings are inferred when an evaluator is attached
    Given a test suite declaring the fields golden_sql and table_schema
    When an evaluator with inputs input, output, expected_output and expected_contexts is attached
    Then input maps to the first user message
    And output maps to the last agent message
    And expected_output maps to the scenario field golden_sql
    And expected_contexts maps to the scenario field table_schema

  @unit
  Scenario: A tool call is never inferred
    Given a target whose traces show a run_sql tool call
    When an evaluator with the input output is attached
    Then output maps to the last agent message and not to the tool call

  @unit
  Scenario: A plan level attachment never maps to a scenario field
    Given a run plan and a suite declaring the field golden_sql
    When an evaluator with the input expected_output is attached to the run plan
    Then expected_output has no mapping

  @unit
  Scenario: An attachment with an unmapped required input opens its drawer on attach
    Given an evaluator whose required input expected_sql matches no field
    When it is attached
    Then the attachment lists expected_sql as missing
    And the evaluator drawer opens right after the attach

  @unit
  Scenario: An attachment with every required input mapped and no expected-like input closes on attach
    Given an evaluator with the required inputs input and output only
    When it is attached
    Then the attachment lists no missing input
    And the evaluator drawer does not open

  # --- Evaluators on a run plan ---

  @integration
  Scenario: A run plan carries its own evaluators beside the suites' ones
    Given a test suite with one attached evaluator
    And a run plan covering that suite with one evaluator of its own
    When the attachments of a run of that plan are read
    Then the suite's attachment comes first and the plan's after it
    And an evaluator attached on both sides is listed once

  # --- Missing mappings refuse a run ---

  @integration
  Scenario: A run is refused while a suite evaluator has a missing required mapping
    Given a test suite with an evaluator whose required input expected_output is unmapped
    When a run of that suite is started
    Then the run is refused with "suite_evaluator_mappings_missing"
    And the refusal names the evaluator, the suite and the input
    And nothing is queued
