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

  @unit @unimplemented
  Scenario: Run with zero criteria shows status without count
    Given a scenario run with status "failed"
    And the run has 0 met criteria and 0 unmet criteria
    When the status label is computed
    Then the label reads "failed"

  # --- Non-terminal statuses remain unchanged ---

  @integration @unimplemented
  Scenario: List view row with iteration shows iteration number in title
    Given a suite run contains a scenario with iteration 1 of 3
    When I view the run in list view
    Then the scenario title includes "(#1)"

  # --- Consistency across views ---

  @integration @unimplemented
  Scenario: Suite detail panel list view uses the same status format
    Given a suite has a completed run with mixed pass/fail results
    When I view the suite detail panel in list view
    Then all scenario rows show "passed" or "failed" with criteria counts

  @integration @unimplemented
  Scenario: All runs panel list view uses the same status format
    Given multiple suites have completed runs
    When I view the all runs panel in list view
    Then all scenario rows show "passed" or "failed" with criteria counts
