Feature: Experiment runs sidebar display
  As a user comparing experiment runs
  I want run names to use the available width and read cleanly
  So that I can tell runs apart at a glance

  Background:
    Given I am viewing the experiment results page
    And the sidebar lists multiple experiment runs

  # ============================================================================
  # Run name formatting
  # ============================================================================

  @integration
  Scenario: A run without a commit message shows index then a middle-dot separator
    Given a run has no commit message and a generated run id "snobbish-otter-1f2a3b"
    And the run is the 10th run chronologically
    When the run is shown in the sidebar
    Then it shows "Run #10" followed by a gray "·" separator and the run id
    And the run id is not wrapped in parentheses

  @integration
  Scenario: The run id uses the available width instead of an early hard truncation
    Given a run has no commit message and a long generated run id
    When the run is shown in the sidebar
    Then the run id is not pre-truncated to eight characters
    And overflow is clipped to a single line by the layout, with the full name in a tooltip

  @integration
  Scenario: A run with a commit message still shows the commit message
    Given a run has a commit message "fix prompt temperature"
    When the run is shown in the sidebar
    Then it shows "fix prompt temperature"
    And it does not show a generated run id suffix
