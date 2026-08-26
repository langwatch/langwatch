Feature: Running a folder reuses the run plan path
  As a person who groups test cases into test suites
  I want Run suite on a folder to behave exactly like running a run plan
  So that the runs, the history and the results look the same wherever they came from

  Background: one run path.
    A folder is a suite, so running a folder starts a batch through the same
    path a custom run plan uses. The batch lands in the folder's own internal
    run set, and every existing history, summary and results view reads it
    without a change.

    Custom run plans still exist beside folders. A custom plan can span several
    folders, a set of labels, or a hand-picked list of cases.

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

  # --- Targets ---

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

  # --- Custom run plans still exist ---

  @integration
  Scenario: A custom run plan can span the cases of several folders
    Given folders "Refunds" and "Checkout" each holding two test cases
    When a custom run plan is created over the cases of both folders
    Then the plan lists four test cases
    And running it schedules those four cases
    And neither folder is changed

  @integration
  Scenario: A custom run plan can select single test cases grouped by their folder
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
