@integration
Feature: Onboarding Progress Backend
  As a user
  I want to know my onboarding progress
  So that I can complete the setup of my project

  Background:
    Given I am authenticated as user "user-123"
    And I have access to project "project-456"

  # All steps
  Scenario: Returns all steps with completion status
    When I request the onboarding status
    Then I should receive all onboarding steps:
      | step              | order |
      | createProject     | 1     |
      | syncFirstMessage  | 2     |
      | createWorkflow    | 3     |
      | createSimulation  | 4     |
      | setupEvaluation   | 5     |
      | createDataset     | 6     |

  # Create project step (always complete)
  Scenario: Step createProject is always complete
    Given the project exists
    When I request the onboarding status
    Then step "createProject" should be complete

  # Sync first message step
  Scenario: Step syncFirstMessage is incomplete when project has no firstMessage
    Given the project has firstMessage set to false
    When I request the onboarding status
    Then step "syncFirstMessage" should be incomplete

  Scenario: Step syncFirstMessage is complete when project has firstMessage
    Given the project has firstMessage set to true
    When I request the onboarding status
    Then step "syncFirstMessage" should be complete

  # Create workflow step
  Scenario: Step createWorkflow is incomplete when no workflows exist
    Given the project has 0 workflows
    When I request the onboarding status
    Then step "createWorkflow" should be incomplete

  Scenario: Step createWorkflow is complete when at least one workflow exists
    Given the project has 1 workflow
    When I request the onboarding status
    Then step "createWorkflow" should be complete

  Scenario: Step createWorkflow ignores archived workflows
    Given the project has 1 archived workflow
    And the project has 0 active workflows
    When I request the onboarding status
    Then step "createWorkflow" should be incomplete

  # Create simulation step
  Scenario: Step createSimulation is incomplete when no simulations exist
    Given the project has 0 scenario sets
    When I request the onboarding status
    Then step "createSimulation" should be incomplete

  Scenario: Step createSimulation is complete when at least one simulation exists
    Given the project has 1 scenario set
    When I request the onboarding status
    Then step "createSimulation" should be complete

  # Setup evaluation step
  Scenario: Step setupEvaluation is incomplete when no evaluations exist
    Given the project has 0 monitors
    When I request the onboarding status
    Then step "setupEvaluation" should be incomplete

  Scenario: Step setupEvaluation is complete when at least one evaluation exists
    Given the project has 1 monitor
    When I request the onboarding status
    Then step "setupEvaluation" should be complete

  # Create dataset step
  Scenario: Step createDataset is incomplete when no datasets exist
    Given the project has 0 datasets
    When I request the onboarding status
    Then step "createDataset" should be incomplete

  Scenario: Step createDataset is complete when at least one dataset exists
    Given the project has 1 dataset
    When I request the onboarding status
    Then step "createDataset" should be complete

  # Overall completion
  Scenario: Returns overall completion percentage - none complete
    Given the project has:
      | firstMessage | false |
      | workflows    | 0     |
      | simulations  | 0     |
      | monitors     | 0     |
      | datasets     | 0     |
    When I request the onboarding status
    Then the completion percentage should be approximately 17

  Scenario: Returns overall completion percentage - all complete
    Given the project has:
      | firstMessage | true |
      | workflows    | 1    |
      | simulations  | 1    |
      | monitors     | 1    |
      | datasets     | 1    |
    When I request the onboarding status
    Then the completion percentage should be 100

  Scenario: Returns overall completion percentage - half complete
    Given the project has:
      | firstMessage | true |
      | workflows    | 1    |
      | simulations  | 0    |
      | monitors     | 0    |
      | datasets     | 0    |
    When I request the onboarding status
    Then the completion percentage should be 50

  # All complete flag
  Scenario: Returns allComplete false when steps remain
    Given the project has firstMessage set to false
    When I request the onboarding status
    Then allComplete should be false

  Scenario: Returns allComplete true when all steps done
    Given the project has:
      | firstMessage | true |
      | workflows    | 1    |
      | simulations  | 1    |
      | monitors     | 1    |
      | datasets     | 1    |
    When I request the onboarding status
    Then allComplete should be true
