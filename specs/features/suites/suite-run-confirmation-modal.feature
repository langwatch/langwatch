Feature: Suite run confirmation modal
  As a user running evaluation suites
  I want a confirmation modal before a suite run is triggered
  So that I can review what will be executed and avoid accidentally scheduling many jobs

  Background:
    Given I am on the Suite detail page
    And the suite "Regression Tests" has 3 scenarios and 2 targets

  # Dialog appearance and informative content
  @integration
  Scenario: Confirmation modal appears when clicking Run
    When I click the "Run" button
    Then I see a confirmation modal with the title "Run suite?"
    And the modal displays the suite name "Regression Tests"

  @integration
  Scenario: Modal displays execution summary with estimated job count
    Given the confirmation modal is open for "Regression Tests"
    Then the modal shows 3 scenarios
    And the modal shows 2 targets
    And the modal shows an estimated 6 jobs

  # Confirm proceeds with the run
  @integration
  Scenario: Confirming the modal triggers the suite run
    Given the confirmation modal is open for "Regression Tests"
    When I click "Run" in the modal
    Then the suite run is triggered
    And the modal closes

  # Cancel aborts without side effects
  @integration
  Scenario: Cancelling the modal does not trigger a run
    Given the confirmation modal is open for "Regression Tests"
    When I click "Cancel"
    Then the modal closes
    And no suite run is triggered

  # Prevent double-submission while run is being scheduled
  @integration
  Scenario: Buttons are disabled while run is being scheduled
    Given the confirmation modal is open for "Regression Tests"
    When the run request is in progress
    Then the Cancel button is disabled
    And the Run button is disabled

  # Error handling
  @integration
  Scenario: Modal closes and error toast appears when run fails
    Given the confirmation modal is open for "Regression Tests"
    When I click "Run" in the modal
    And the run request fails
    Then the modal closes
    And an error notification appears
