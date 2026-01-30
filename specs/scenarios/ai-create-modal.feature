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

  @e2e
  Scenario: Open AI create modal from scenarios list
    When I click the "New Scenario" button
    Then I see the AI create modal
    And I see the title "Create new scenario"
    And I see a textarea with placeholder text
    And I see the "Generate with AI" button
    And I see the "Skip" button

  @e2e
  Scenario: Generate scenario with AI using custom description
    When I click the "New Scenario" button
    And I enter "A customer support agent that helps users reset their passwords" in the textarea
    And I click "Generate with AI"
    Then I see the generating state with spinner
    And I see "Generating scenario..." text
    When generation completes successfully
    Then I am navigated to the scenario editor
    And the editor is pre-filled with the generated scenario

  @e2e
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

  @e2e
  Scenario: Skip AI generation and create blank scenario
    When I click the "New Scenario" button
    And I click "Skip"
    Then a new empty scenario is created
    And I am navigated to the scenario editor
    And the editor shows empty fields

  # ============================================================================
  # Modal States and Controls
  # ============================================================================

  @integration
  Scenario: Modal displays character counter
    When I click the "New Scenario" button
    And I enter "Test description" in the textarea
    Then I see the character counter showing "16 / 500"

  @integration
  Scenario: Character counter enforces 500 character limit
    When I click the "New Scenario" button
    And I enter a 500 character description
    Then the character counter shows "500 / 500"
    And I cannot enter more characters

  @integration
  Scenario: Close modal with close button in default state
    When I click the "New Scenario" button
    And I click the close button
    Then the modal closes
    And I remain on the scenarios list page

  @integration
  Scenario: Modal is not dismissable during generation
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    Then the modal shows the generating state
    And the close button is not visible
    And clicking outside the modal does not close it

  # ============================================================================
  # Example Templates
  # ============================================================================

  @integration
  Scenario: Customer Support example fills textarea
    When I click the "New Scenario" button
    And I click the "Customer Support" example pill
    Then the textarea contains "A customer support agent that handles complaints. Test an angry customer who was charged twice and wants a refund."

  @integration
  Scenario: RAG Q&A example fills textarea
    When I click the "New Scenario" button
    And I click the "RAG Q&A" example pill
    Then the textarea contains "A knowledge bot that answers questions from documentation. Test a question that requires combining info from multiple sources."

  @integration
  Scenario: Tool-calling Agent example fills textarea
    When I click the "New Scenario" button
    And I click the "Tool-calling Agent" example pill
    Then the textarea contains "An agent that uses tools to complete tasks. Test a request that requires calling multiple tools in sequence."

  # ============================================================================
  # Error Handling
  # ============================================================================

  @integration
  Scenario: Display error state when generation fails
    Given the AI generation service returns an error
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    Then I see the error state
    And I see "Something went wrong" title
    And I see the error message from the API
    And I see the "Try again" button
    And I see the "Skip" button
    And the close button is visible

  @integration
  Scenario: Retry generation after error
    Given the AI generation service returns an error
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    And I see the error state
    When the AI generation service recovers
    And I click "Try again"
    Then I see the generating state
    When generation completes successfully
    Then I am navigated to the scenario editor

  @integration
  Scenario: Skip to blank editor from error state
    Given the AI generation service returns an error
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    And I see the error state
    And I click "Skip"
    Then a new empty scenario is created
    And I am navigated to the scenario editor

  @integration
  Scenario: Generation times out after 60 seconds
    Given the AI generation service does not respond
    When I click the "New Scenario" button
    And I enter a description
    And I click "Generate with AI"
    And 60 seconds pass
    Then I see the error state
    And I see a timeout error message

  @integration
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

  @integration
  Scenario: Generated scenario passes prompt via URL parameter
    When I click the "New Scenario" button
    And I enter "My test scenario description" in the textarea
    And I click "Generate with AI"
    And generation completes successfully
    Then the URL contains "initialPrompt" parameter
    And the parameter value is the description I entered

  # ============================================================================
  # Component Reusability (Unit Tests)
  # ============================================================================

  @unit
  Scenario: AICreateModal accepts custom title prop
    Given an AICreateModal component
    When rendered with title "Create new prompt"
    Then it displays "Create new prompt" as the title

  @unit
  Scenario: AICreateModal accepts custom placeholder prop
    Given an AICreateModal component
    When rendered with custom placeholder text
    Then the textarea displays the custom placeholder

  @unit
  Scenario: AICreateModal calls onGenerate callback with description
    Given an AICreateModal component with onGenerate callback
    When user enters "Test description" and clicks generate
    Then the onGenerate callback is called with "Test description"

  @unit
  Scenario: AICreateModal calls onSkip callback
    Given an AICreateModal component with onSkip callback
    When user clicks Skip
    Then the onSkip callback is called

  @unit
  Scenario: AICreateModal transitions between states correctly
    Given an AICreateModal component
    When state changes from idle to generating
    Then the UI updates to show generating state
    When state changes from generating to error
    Then the UI updates to show error state
    When state changes from error to idle
    Then the UI updates to show idle state

  @unit
  Scenario: Example templates are configurable
    Given an AICreateModal component
    When rendered with custom example templates
    Then it displays the custom example pills
    And clicking a pill fills the textarea with the template text
