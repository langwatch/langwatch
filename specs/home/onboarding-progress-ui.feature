@unit
Feature: Onboarding Progress UI
  As a user
  I want to see my onboarding progress on the home page
  So that I know what steps I need to complete

  Background:
    Given I am on the home page

  # Visibility
  Scenario: Hides component when all steps complete
    Given the onboarding API returns allComplete as true
    When I view the home page
    Then the onboarding progress section should not be visible

  Scenario: Shows component when steps remain
    Given the onboarding API returns allComplete as false
    When I view the home page
    Then the onboarding progress section should be visible

  # Progress display
  Scenario: Shows progress percentage - 17%
    Given the onboarding API returns completion percentage of 17
    When I view the onboarding progress section
    Then I should see "17%" or "17% completed" text

  Scenario: Shows progress percentage - 50%
    Given the onboarding API returns completion percentage of 50
    When I view the onboarding progress section
    Then I should see "50%" or "50% completed" text

  # Step states - Completed
  Scenario: Completed steps show checkmark indicator
    Given step "createProject" is complete
    When I view the onboarding progress section
    Then the "Create project" step should show a completion indicator

  # Step states - Current (first incomplete)
  Scenario: Current step is identifiable
    Given step "createProject" is complete
    And step "syncFirstMessage" is incomplete
    When I view the onboarding progress section
    Then the "Sync first message" step should be marked as current

  Scenario: Current step shows action button
    Given the current step is "syncFirstMessage"
    When I view the onboarding progress section
    Then I should see a "Start" or action button for the current step

  # Step states - Future
  Scenario: Future steps show as pending
    Given step "syncFirstMessage" is incomplete
    And step "createWorkflow" is incomplete
    When I view the onboarding progress section
    Then the "Create workflow" step should show as pending

  # Step content
  Scenario: Each step shows title
    Given the onboarding has incomplete steps
    When I view the onboarding progress section
    Then each visible step should show a title

  # Navigation - Clicking steps
  Scenario: Clicking syncFirstMessage step navigates to messages page
    Given the current step is "syncFirstMessage"
    When I click the action for "Sync first message"
    Then I should be navigated to the messages page

  Scenario: Clicking createWorkflow step navigates to workflows page
    Given the current step is "createWorkflow"
    When I click the action for "Create workflow"
    Then I should be navigated to the workflows page

  Scenario: Clicking createSimulation step navigates to simulations page
    Given the current step is "createSimulation"
    When I click the action for "Create simulation"
    Then I should be navigated to the simulations page

  Scenario: Clicking setupEvaluation step navigates to evaluations page
    Given the current step is "setupEvaluation"
    When I click the action for "Set up evaluation"
    Then I should be navigated to the evaluations page

  Scenario: Clicking createDataset step navigates to datasets page
    Given the current step is "createDataset"
    When I click the action for "Create dataset"
    Then I should be navigated to the datasets page

  # Step navigation within the component
  Scenario: Can view completed steps
    Given steps "createProject" and "syncFirstMessage" are complete
    And the current step is "createWorkflow"
    When I navigate to view completed steps
    Then I should see the completed steps

  Scenario: Can view future pending steps
    Given the current step is "syncFirstMessage"
    When I navigate to view future steps
    Then I should see the remaining pending steps

  Scenario: Can navigate back to current step from completed steps view
    Given I am viewing completed steps
    When I navigate back to current
    Then the current step should be visible

  @visual
  Scenario: Displays vertical stepper layout
    Given the onboarding API returns incomplete steps
    When I view the onboarding progress section
    Then steps should be displayed in a vertical layout

  @visual
  Scenario: Shows progress bar
    Given the onboarding API returns completion percentage of 50
    When I view the onboarding progress section
    Then I should see a progress bar indicator

  # Loading state
  @visual
  Scenario: Shows loading state while fetching
    Given the onboarding API is loading
    When I view the home page
    Then I should see a loading indicator for the onboarding section
