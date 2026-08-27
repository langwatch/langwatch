Feature: Running a folder reuses the run plan path
  As a person who groups test cases into test suites
  I want Run suite on a folder to behave exactly like running a run plan
  So that the runs, the history and the results look the same wherever they came from

  Background: one run path, and a folder row that holds no execution settings.
    A folder is a suite, so running a folder starts a batch through the same
    path a custom run plan uses. Every existing history, summary and results
    view reads that batch without a change.

    Custom run plans still exist beside folders. A custom plan can span several
    folders, a set of labels, or a hand-picked list of cases.

    In the product a test suite is only a grouping: it has a name and a set of
    scenarios, and nothing else. The run dialog holds the targets, the repeat
    count and the models. A run started there goes through the run plan path,
    which writes the whole configuration onto a RUN PLAN.

    The folder ROW carries no `targets`, no `repeatCount`, no `simulatorModel`
    and no `judgeModel`. A second place holding execution settings is a second
    answer to what a run uses, and the two drift: a run started from the
    dialog would say one thing and the row another, with nothing saying which
    one the next run reads.

    So every caller sends the execution settings with the run. A caller that
    addresses a folder by its id and starts a run without a dialog,
    `langwatch suite run <folder-id>`, the MCP tool and the SDK, sends the
    targets in the request. A request that names none is refused with
    `suite_targets_required` rather than falling back to a stored row.

    The v1 Simulations pages must never show a folder. See
    specs/suites/suite-folders.feature for folder creation and archiving.

  # --- Running a folder ---

  @integration
  Scenario: Running a folder schedules its active cases against the chosen targets
    Given a folder holding three active test cases and one archived test case
    And the run is started against two targets
    When Run suite is chosen on the folder
    Then six runs are scheduled
    And the archived test case is not covered
    And the batch belongs to the run plan the run resolved

  @integration
  Scenario: A folder run appears in the results view under the folder's name
    Given a folder "Refunds" with a finished run
    When the Test Runs list is opened
    Then the run plan that run resolved is listed, named after "Refunds"
    And opening it shows the run in the runs sidebar

  @unit
  Scenario: A folder run honours the repeat count sent with the run
    Given a folder with two test cases and one target
    And the run is started with a repeat count of three
    When the folder is run
    Then six runs are scheduled

    The repeat count travels with the request. The folder row holds none, so
    there is nothing to read it from and nothing to keep in step.

  # --- The last run plan is the memory ---

  @integration
  Scenario: The target chosen for a folder run is offered again from the last run plan of that suite
    Given a folder that was last run against the target "prod-agent"
    When the run plan that run resolved is read
    Then it holds "prod-agent" as its target
    And the folder row still holds no target

  @integration
  Scenario: Running a folder with no target is refused with suite_targets_required
    Given a folder that has never been run and holds two active test cases
    When a run is requested with no target selected
    Then the run is refused with "suite_targets_required"
    And no run is scheduled
    And the dialog shows the Setup agent empty state

  @integration
  Scenario: Running a folder whose cases are all archived is refused with suite_scope_empty
    Given a folder in which every test case is archived
    When the folder is run
    Then the run is refused with "suite_scope_empty"
    And no run is scheduled

    A run of a suite covers what the suite holds right now, so a suite whose
    cases are all archived covers nothing. That is the empty scope, not a run
    that named archived cases and skipped them.

  # --- A folder row never learns execution settings ---

  @integration
  Scenario: Updating a folder with execution settings is refused with validation_error
    Given a folder suite in the project
    When targets, a repeat count or a model is written onto it
    Then the change is refused with "validation_error"
    And the refusal names every execution field the request carried
    And the folder row is unchanged

  @integration
  Scenario: The stored execution settings are cleared off every folder row
    Given a folder row carrying targets, a repeat count and model overrides
    And a custom run plan carrying the same settings
    When the migration runs
    Then the folder row holds no target, a repeat count of one and no model
    And the custom run plan keeps everything it held

  @unit
  Scenario: A run plan run through the folder path refuses stored execution settings
    Given a custom run plan addressed by its id
    When the request carries targets, a repeat count or a model
    Then the run is refused with "validation_error"
    And the message says a new configuration goes to the run plan path

  # --- The product UI never treats a folder as a run plan ---

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
    And so it cannot put targets, a repeat count or a model on a folder

  # --- Custom run plans still exist ---

  @integration
  Scenario: A custom run plan can span the cases of several folders
    Given folders "Refunds" and "Checkout" each holding two test cases
    When a custom run plan is created over the cases of both folders
    Then the plan lists four test cases
    And running it schedules those four cases
    And neither folder is changed

  @integration
  Scenario: A custom run plan can select single scenarios grouped by their folder
    Given folders "Refunds" and "Checkout" each holding two test cases
    When a custom run plan is created and its case picker is opened
    Then the cases are listed under their folder names
    And picking one case from each folder saves a plan of two cases

  # --- The v1 guard ---

  @integration
  Scenario: The v1 run plan list holds no folder rows
    Given a project with two folders and one custom run plan
    When the v1 run plan list is read
    Then only the custom run plan is listed
    And the same list read over the public suites endpoint returns only the custom run plan

  @integration
  Scenario: The v2 Test Runs list holds custom run plans only
    Given a project with two folders and one custom run plan
    When the v2 Test Runs list is read
    Then only the custom run plan is listed
    And the folders are read from the test suites list instead

  @unit
  Scenario: Archived run plans are listed only when the caller asks for them
    Given a project holding one active run plan and one archived run plan
    When run plans are listed
    Then only the active plan comes back
    But a caller that asks for archived plans sees both

  @unit
  Scenario: A caller that names no kind of suite gets custom run plans only
    Given a project with folders and custom run plans
    When suites are listed without naming a kind
    Then only custom run plans come back
