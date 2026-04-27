Feature: Suite list view status with criteria count
  As a LangWatch user
  I want the list view to show passed/failed status with criteria counts
  So that I can see at a glance whether a scenario passed and how many criteria were met

  # The list view currently shows inconsistent values like "100%" for success
  # and "failed" for failures. This feature standardizes the status display
  # to always show "passed" or "failed" with criteria counts in parentheses,
  # e.g. "passed (4/5)" or "failed (3/5)".

  Background:
    Given I am logged into project "my-project"

  # --- Status label formatting ---

  @unit
  Scenario: Successful run shows "passed" with criteria count
    Given a scenario run with status "success"
    And the run has 5 met criteria and 0 unmet criteria
    When the status label is computed
    Then the label reads "passed (5/5)"

  @unit
  Scenario: Failed run shows "failed" with criteria count
    Given a scenario run with status "failed"
    And the run has 3 met criteria and 2 unmet criteria
    When the status label is computed
    Then the label reads "failed (3/5)"

  @unit
  Scenario: Run with no criteria results shows status without count
    Given a scenario run with status "success"
    And the run has no evaluation results
    When the status label is computed
    Then the label reads "passed"

  @unit
  Scenario: Run with zero criteria shows status without count
    Given a scenario run with status "failed"
    And the run has 0 met criteria and 0 unmet criteria
    When the status label is computed
    Then the label reads "failed"

  # --- Non-terminal statuses remain unchanged ---

  @unit
  Scenario: In-progress run shows "running" without criteria count
    Given a scenario run with status "in_progress"
    When the status label is computed
    Then the label reads "running"

  @unit
  Scenario: Pending run shows "pending" without criteria count
    Given a scenario run with status "pending"
    When the status label is computed
    Then the label reads "pending"

  # --- List view rendering ---

  @integration
  Scenario: List view row displays passed status with criteria count
    Given a suite run contains a scenario that passed with 4/5 criteria met
    When I view the run in list view
    Then the scenario row shows "passed (4/5)"
    And does not show "100%"

  @integration
  Scenario: List view row displays failed status with criteria count
    Given a suite run contains a scenario that failed with 2/5 criteria met
    When I view the run in list view
    Then the scenario row shows "failed (2/5)"

  # --- Iteration display ---

  @integration
  Scenario: List view row with iteration shows iteration number in title
    Given a suite run contains a scenario with iteration 1 of 3
    When I view the run in list view
    Then the scenario title includes "(#1)"

  # --- Consistency across views ---

  @integration
  Scenario: Suite detail panel list view uses the same status format
    Given a suite has a completed run with mixed pass/fail results
    When I view the suite detail panel in list view
    Then all scenario rows show "passed" or "failed" with criteria counts

  @integration
  Scenario: All runs panel list view uses the same status format
    Given multiple suites have completed runs
    When I view the all runs panel in list view
    Then all scenario rows show "passed" or "failed" with criteria counts
