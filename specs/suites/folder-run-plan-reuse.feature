Feature: Running a folder reuses the run plan path
  As a person who groups test cases into test suites
  I want Run suite on a folder to behave exactly like running a run plan
  So that the runs, the history and the results look the same wherever they came from

  Background: one run path, and why a folder row still holds run settings.
    A folder is a suite, so running a folder starts a batch through the same
    path a custom run plan uses. The batch lands in the folder's own internal
    run set, and every existing history, summary and results view reads it
    without a change.

    Custom run plans still exist beside folders. A custom plan can span several
    folders, a set of labels, or a hand-picked list of cases.

    In the product a test suite is only a grouping: it has a name and a set of
    scenarios, and the run dialog holds the targets, the repeat count and the
    models. A run started there goes through the run plan path, which writes
    the whole configuration onto a RUN PLAN and never onto the folder.

    The folder ROW still carries `targets`, `repeatCount`, `simulatorModel`
    and `judgeModel`, and this is deliberate. A caller can address a folder by
    its id and start a run without a dialog: `langwatch suite run <folder-id>`,
    the MCP tool, and the SDK all reach `POST /api/suites/:id/run`. Those
    callers send no targets, so without the row they would have nothing to run
    against. The row is therefore the LAST USED execution settings of that
    folder, kept for id-addressed callers. It is NOT a plan config, nothing in
    the product reads it as one, and a run started from the UI never writes it.

    Two things follow, and both are correct rather than oversights:

      - a folder accepts targets and models through the suite update path, so
        an id-addressed caller can set what its next run uses. See
        specs/suites/suite-folders.feature. Do not "fix" this by refusing them.
      - the product UI is what must never drift back into treating a folder as
        a run plan, so that is pinned by its own scenarios below.

    The v1 Simulations pages must never show a folder. See
    specs/suites/suite-folders.feature for folder creation and archiving.

  # --- Running a folder ---

  @integration
  Scenario: Running a folder schedules its active cases against the chosen targets
    Given a folder holding three active test cases and one archived test case
    And the run is started against two targets
    When Run suite is chosen on the folder
    Then six runs are scheduled
    And the archived test case is reported as skipped
    And the batch belongs to the folder's own run set

  @integration
  Scenario: A folder run appears in the results view under the folder's name
    Given a folder "Refunds" with a finished run
    When the Test Runs list is opened
    Then "Refunds" is listed as a run plan
    And opening it shows the run in the runs sidebar

  @unit
  Scenario: A folder run honours the repeat count on the folder
    Given a folder with two test cases, one target and a repeat count of three
    When the folder is run
    Then six runs are scheduled

    The repeat count is read off the row because this run was addressed by
    folder id and carried none of its own.

  # --- The row as a last-used memory ---

  @integration
  Scenario: The target chosen for a folder run is offered again next time
    Given a folder that was last run against the target "prod-agent"
    When the run dialog for that folder opens again
    Then "prod-agent" is already selected
    And confirming starts the run without another choice

  @integration
  Scenario: Running a folder with no target is refused with suite_targets_required
    Given a folder that has never been run and holds two active test cases
    When a run is requested with no target selected
    Then the run is refused with "suite_targets_required"
    And no run is scheduled
    And the dialog shows the Setup agent empty state

  @integration
  Scenario: Running a folder whose cases are all archived is refused with suite_all_scenarios_archived
    Given a folder in which every test case is archived
    When the folder is run
    Then the run is refused with "suite_all_scenarios_archived"
    And no run is scheduled

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
  Scenario: The v2 Test Runs list holds both folders and custom run plans
    Given a project with two folders and one custom run plan
    When the v2 Test Runs list is read
    Then the two folders and the custom run plan are all listed
    And the folders are listed first

  @unit
  Scenario: A caller that names no kind of suite gets custom run plans only
    Given a project with folders and custom run plans
    When suites are listed without naming a kind
    Then only custom run plans come back
