Feature: Running a test suite reuses the run plan path
  As a person who groups scenarios into test suites
  I want Run suite on a test suite to behave exactly like running a run plan
  So that the runs, the history and the results look the same wherever they came from

  Background: one run path, and a test suite row that holds no execution settings.
    A test suite is a suite, so running a test suite starts a batch through the same
    path a run plan uses. Every existing history, summary and results
    view reads that batch without a change.

    Run plans still exist beside test suites. A run plan can span several
    test suites, a set of labels, or a hand-picked list of scenarios.

    In the product a test suite is only a grouping: it has a name and a set of
    scenarios, and nothing else. The run dialog holds the targets, the repeat
    count and the models. A run started there goes through the run plan path,
    which writes the whole configuration onto a RUN PLAN.

    The test suite ROW holds no execution setting of its own: `targets` is
    empty, `repeatCount` is the column default of one, and `simulatorModel` and
    `judgeModel` are null. The columns stay on the table because a run plan row
    uses all four. A second place holding execution settings is a second answer
    to what a run uses, and the two drift: a run started from the dialog would
    say one thing and the row another, with nothing saying which one the next
    run reads.

    So every caller sends the execution settings with the run. A caller that
    addresses a test suite by its id and starts a run without a dialog,
    `langwatch suite run <test-suite-id>`, the MCP tool and the SDK, sends the
    targets in the request. A request that names none is refused with
    `suite_targets_required` rather than falling back to a stored row.

    The v1 Simulations pages must never show a test suite. See
    specs/suites/test-suites.feature for test suite creation and archiving.

  # --- Running a test suite ---

  @integration
  Scenario: Running a test suite schedules its active scenarios against the chosen targets
    Given a test suite holding three active scenarios and one archived scenario
    And the run is started against two targets
    When Run suite is chosen on the test suite
    Then six runs are scheduled
    And the archived scenario is not covered
    And the batch belongs to the run plan the run resolved

  @integration
  Scenario: A test suite run appears in the results view under the test suite's name
    Given a test suite "Refunds" with a finished run
    When the Test Runs list is opened
    Then the run plan that run resolved is listed, named after "Refunds"
    And opening it shows the run in the runs sidebar

  @unit
  Scenario: A test suite run honours the repeat count sent with the run
    Given a test suite with two scenarios and one target
    And the run is started with a repeat count of three
    When the test suite is run
    Then six runs are scheduled

    The repeat count travels with the request. The test suite row holds only
    the column default of one, so there is nothing to read it from and nothing
    to keep in step.

  # --- The last run plan is the memory ---

  @integration
  Scenario: The target chosen for a test suite run is offered again from the last run plan of that suite
    Given a test suite that was last run against the target "prod-agent"
    When the run plan that run resolved is read
    Then it holds "prod-agent" as its target
    And the test suite row still holds no target

  @integration
  Scenario: Running a test suite with no target is refused with suite_targets_required
    Given a test suite that has never been run and holds two active scenarios
    When a run is requested with no target selected
    Then the run is refused with "suite_targets_required"
    And no run is scheduled
    And the dialog shows the Setup agent empty state

  @integration
  Scenario: Running a test suite whose scenarios are all archived is refused with suite_scope_empty
    Given a test suite in which every scenario is archived
    When the test suite is run
    Then the run is refused with "suite_scope_empty"
    And no run is scheduled

    A run of a suite covers what the suite holds right now, so a suite whose
    scenarios are all archived covers nothing. That is the empty scope, not a run
    that named archived scenarios and skipped them.

  # --- A test suite row never learns execution settings ---

  @integration
  Scenario: Updating a test suite with execution settings is refused with validation_error
    Given a test suite in the project
    When targets, a repeat count or a model is written onto it
    Then the change is refused with "validation_error"
    And the refusal names every execution field the request carried
    And the test suite row is unchanged

  @integration
  Scenario: The stored execution settings are cleared off every test suite row
    Given a test suite row carrying targets, a repeat count and model overrides
    And a run plan carrying the same settings
    When the migration runs
    Then the test suite row holds no target, a repeat count of one and no model
    And the run plan keeps everything it held

  @unit
  Scenario: A run plan run through the test suite path refuses stored execution settings
    Given a run plan addressed by its id
    When the request carries targets, a repeat count or a model
    Then the run is refused with "validation_error"
    And the message says a new configuration goes to the run plan path

  # --- The product UI never treats a test suite as a run plan ---

  @unit
  Scenario: The Agent Testing UI runs only through the run plan procedure
    Given the Agent Testing feature source
    When every run it can start is read
    Then it reaches the run plan procedure
    And it reaches neither the suite run procedure nor the run all procedure

  @unit
  Scenario: The Agent Testing UI writes no execution settings onto a suite row
    Given the Agent Testing feature source
    When every suite it writes is read
    Then it calls neither the suite create procedure nor the suite update procedure
    And so it cannot put targets, a repeat count or a model on a test suite

  # --- Run plans still exist ---

  @integration
  Scenario: A run plan can span the scenarios of several test suites
    Given test suites "Refunds" and "Checkout" each holding two scenarios
    When a run plan is created over the scenarios of both test suites
    Then the plan lists four scenarios
    And running it schedules those four scenarios
    And neither test suite is changed

  @integration
  Scenario: A run plan can select single scenarios grouped by their test suite
    Given test suites "Refunds" and "Checkout" each holding two scenarios
    When a run plan is created and its scenario picker is opened
    Then the scenarios are listed under their test suite names
    And picking one scenario from each test suite saves a plan of two scenarios

  # --- The v1 guard ---

  @integration
  Scenario: The v1 run plan list holds no test suite rows
    Given a project with two test suites and one run plan
    When the v1 run plan list is read
    Then only the run plan is listed
    And the same list read over the public suites endpoint returns only the run plan

  @integration
  Scenario: The v2 Test Runs list holds run plans only
    Given a project with two test suites and one run plan
    When the v2 Test Runs list is read
    Then only the run plan is listed
    And the test suites are read from the test suites list instead

  @unit
  Scenario: Archived run plans are listed only when the caller asks for them
    Given a project holding one active run plan and one archived run plan
    When run plans are listed
    Then only the active plan comes back
    But a caller that asks for archived plans sees both

  @unit
  Scenario: A caller that names no kind of suite gets run plans only
    Given a project with test suites and run plans
    When suites are listed without naming a kind
    Then only run plans come back
