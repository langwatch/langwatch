@unit
Feature: Quick Access Links
  As a user
  I want quick access to key platform features
  So that I can easily navigate to common tasks

  Background:
    Given I am on the home page
    And I have access to project "test-project"

  # Card count
  Scenario: Displays 4 feature cards
    When I view the quick access links section
    Then I should see 4 feature cards

  # Observability card - Not integrated
  Scenario: Observability card links to setup when not integrated
    Given the project is not integrated (no firstMessage)
    When I view the Observability card
    Then the primary link should go to "/test-project/setup"

  # Observability card - Integrated
  Scenario: Observability card links to messages when integrated
    Given the project is integrated (has firstMessage)
    When I view the Observability card
    Then the primary link should go to "/test-project/messages"

  Scenario: Observability card has docs link
    When I view the Observability card
    Then I should see a docs link containing "docs" and "integration"

  # Agent Simulations card
  Scenario: Agent Simulations card links to simulations
    When I view the Agent Simulations card
    Then the primary link should go to "/test-project/simulations"

  Scenario: Agent Simulations card has docs link
    When I view the Agent Simulations card
    Then I should see a docs link containing "docs" and "simulations"

  # Prompt Management card
  Scenario: Prompt Management card links to prompts
    When I view the Prompt Management card
    Then the primary link should go to "/test-project/prompts"

  Scenario: Prompt Management card has docs link
    When I view the Prompt Management card
    Then I should see a docs link containing "docs" and "prompt"

  # Evaluations card
  Scenario: Evaluations card links to evaluations
    When I view the Evaluations card
    Then the primary link should go to "/test-project/evaluations"

  Scenario: Evaluations card has docs link
    When I view the Evaluations card
    Then I should see a docs link containing "docs" and "evaluation"

  # Tracking
  Scenario: Card click is tracked
    When I click on a quick access card
    Then a tracking event should be sent for "quick_access_click"

  @visual
  Scenario: Cards are arranged in responsive grid
    When I view the quick access links section
    Then the cards should be arranged in a grid layout
