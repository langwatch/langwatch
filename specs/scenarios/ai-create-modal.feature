Feature: AI Create Modal for Scenarios
  As a LangWatch user
  I want an AI-assisted modal for creating scenarios
  So that I can quickly generate scenario templates based on my description

  Background:
    Given I am logged into project "my-project"
    And I am on the scenarios list page

  # ============================================================================
  # Happy Path - Generate with AI
  # ============================================================================

  @integration @unimplemented
  Scenario: Open AI create modal from scenarios list
    When I click the "New Scenario" button
    Then I see the AI create modal
    And I see the title "Create new scenario"
    And I see a textarea with placeholder text
    And I see the "Generate with AI" button
    And I see the "I'll write it myself" button

  @e2e @unimplemented
  Scenario: Generate scenario with AI using custom description
    When I click the "New Scenario" button
    And I enter "A customer support agent that helps users reset their passwords" in the textarea
    And I click "Generate with AI"
    Then I see the generating state with spinner
    And I see "Generating scenario..." text
    When generation completes successfully
    Then I am navigated to the scenario editor
    And the editor is pre-filled with the generated scenario

  @integration @unimplemented
  Scenario: Use example template to generate scenario
    When I click the "New Scenario" button
    And I click the "Customer Support" example pill
    Then the textarea is filled with the customer support template
    When I click "Generate with AI"
    And generation completes successfully
    Then I am navigated to the scenario editor with pre-filled content

  # ============================================================================
  # Skip to Builder Flow
  # ============================================================================

  @e2e @unimplemented
  Scenario: Skip AI generation and create blank scenario
    When I click the "New Scenario" button
    And I click "I'll write it myself"
    Then a new empty scenario is created
    And I am navigated to the scenario editor
    And the editor shows empty fields

  # ============================================================================
  # Modal States and Controls
  # ============================================================================

  @integration @unimplemented
  Scenario: Close modal with close button in default state
    When I click the "New Scenario" button
    And I click the close button
    Then the modal closes
    And I remain on the scenarios list page

  # ============================================================================
  # Example Templates
  # ============================================================================

  # ============================================================================
  # Error Handling
  # ============================================================================

  @integration @unimplemented
  Scenario: Skip to blank editor from error state
    Given the AI generation service returns an error
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    And I see the error state
    And I click "I'll write it myself"
    Then a new empty scenario is created
    And I am navigated to the scenario editor

  @integration @unimplemented
  Scenario: Display error when API keys not configured
    Given the user has no API keys configured for the default model
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    Then I see the error state
    And I see "API keys not configured" in the error message
    And I see guidance to configure API keys in Settings

  # ============================================================================
  # No Model Provider Warning (Proactive)
  # ============================================================================

  @integration @unimplemented
  Scenario: Navigate to model provider settings from warning
    Given I have no model providers configured
    When I click the "New Scenario" button
    And I click the link to configure model providers
    Then I am navigated to the model provider settings page

  @integration @unimplemented
  Scenario: Close modal from error state
    Given the AI generation service returns an error
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    And I see the error state
    And I click the close button
    Then the modal closes
    And I remain on the scenarios list page

  # ============================================================================
  # URL Parameter Integration
  # ============================================================================

  # ============================================================================
  # Component Reusability (Unit Tests)
  # ============================================================================

