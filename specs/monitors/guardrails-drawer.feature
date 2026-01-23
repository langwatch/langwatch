@integration
Feature: Guardrails Drawer
  As a user
  I want to set up guardrails using my evaluators
  So that I can protect users from harmful outputs

  Background:
    Given I am logged in to a project
    And I have at least one evaluator created

  Scenario: Open evaluator list directly from menu
    Given I am on the evaluations page
    When I select "New Guardrail" from the menu
    Then the evaluator list drawer should open
    And I should see my existing evaluators

  Scenario: Select existing evaluator for guardrail
    Given I selected "New Guardrail" and the evaluator list is open
    When I select evaluator "PII Check" with slug "pii-check-abc12"
    Then the guardrails drawer should show code integration
    And the code should reference "evaluators/pii-check-abc12"

  Scenario: Python code shows async by default
    Given the guardrails code block is displayed
    Then the Python tab should be active by default
    And the code should use async/await pattern
    And the code should show the langwatch SDK usage

  Scenario: Python async code template
    Given I selected an evaluator with slug "safety-check-xyz99"
    Then the Python code should include:
      """
      import langwatch

      await langwatch.guardrails.async_evaluate(
          evaluator="evaluators/safety-check-xyz99",
          input=user_input,
          output=llm_output
      )
      """

  Scenario: Switch to TypeScript tab
    Given the guardrails code block is displayed
    When I click "TypeScript" tab
    Then TypeScript code should be shown
    And it should use the langwatch TypeScript SDK

  Scenario: TypeScript code template
    Given I selected an evaluator with slug "safety-check-xyz99"
    When I switch to TypeScript tab
    Then the code should include:
      """
      import { Langwatch } from "langwatch";

      const langwatch = new Langwatch();

      await langwatch.guardrails.evaluate({
          evaluator: "evaluators/safety-check-xyz99",
          input: userInput,
          output: llmOutput
      });
      """

  Scenario: Switch to curl tab
    Given the guardrails code block is displayed
    When I click "curl" tab
    Then curl example should be shown
    And it should show the raw API endpoint

  Scenario: Curl code template
    Given I selected an evaluator with slug "safety-check-xyz99"
    When I switch to curl tab
    Then the code should include:
      """
      curl -X POST https://app.langwatch.ai/api/guardrails/evaluators/safety-check-xyz99/evaluate \
        -H "X-Auth-Token: $LANGWATCH_API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"input": "user input", "output": "llm output"}'
      """

  Scenario: Copy code to clipboard
    Given the guardrails code block is displayed
    When I click the copy button
    Then the code should be copied to clipboard
    And a success feedback should appear

  Scenario: Close without saving
    Given the guardrails code is displayed
    When I click "Close"
    Then the drawer should close
    And no monitor should be created
    Because guardrails are code-based, not stored as monitors

  Scenario: Create new evaluator during guardrail setup
    Given the evaluator list is open for guardrail setup
    When I click "Create New Evaluator"
    Then I should be able to create a new evaluator
    When I save the new evaluator
    Then I should return with the new evaluator selected
    And the code block should show the new evaluator's slug

  Scenario: Evaluator without slug shows ID (fallback)
    Given I have an old evaluator without a slug (legacy)
    When I select this evaluator
    Then the code should use the evaluator ID as fallback
    Or a warning should suggest generating a slug

  Scenario: API key placeholder in code
    Given the guardrails code block is displayed
    Then the code should include a placeholder for the API key
    And it should reference the environment variable LANGWATCH_API_KEY

  Scenario: Project-specific API endpoint
    Given my project has a custom API endpoint
    When the code block is displayed
    Then the endpoint in curl should reflect the project settings

  Scenario: Show evaluator description in drawer
    Given I selected an evaluator with description "Checks for PII"
    Then the guardrails drawer should show the evaluator name
    And the description should be visible for context
