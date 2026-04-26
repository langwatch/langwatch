@integration
Feature: Guardrails Drawer
  As a user
  I want to set up guardrails using my evaluators
  So that I can protect users from harmful outputs

  Background:
    Given I am logged in to a project
    And I have at least one evaluator created

  @unimplemented
  Scenario: Select existing evaluator for guardrail
    Given I selected "New Guardrail" and the evaluator list is open
    When I select evaluator "PII Check" with slug "pii-check-abc12"
    Then the guardrails drawer should show code integration
    And the code should reference "evaluators/pii-check-abc12"

  @unimplemented
  Scenario: Python code shows async by default
    Given the guardrails code block is displayed
    Then the Python tab should be active by default
    And the code should use async/await pattern
    And the code should show the langwatch SDK usage

  @unimplemented
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

  @unimplemented
  Scenario: Switch to TypeScript tab
    Given the guardrails code block is displayed
    When I click "TypeScript" tab
    Then TypeScript code should be shown
    And it should use the langwatch TypeScript SDK

  @unimplemented
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

  @unimplemented
  Scenario: Switch to curl tab
    Given the guardrails code block is displayed
    When I click "curl" tab
    Then curl example should be shown
    And it should show the raw API endpoint

  @unimplemented
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

  @unimplemented
  Scenario: Copy code to clipboard
    Given the guardrails code block is displayed
    When I click the copy button
    Then the code should be copied to clipboard
    And a success feedback should appear

  @unimplemented
  Scenario: Close without saving
    Given the guardrails code is displayed
    When I click "Close"
    Then the drawer should close
    And no monitor should be created
    Because guardrails are code-based, not stored as monitors

  @unimplemented
  Scenario: API key placeholder in code
    Given the guardrails code block is displayed
    Then the code should include a placeholder for the API key
    And it should reference the environment variable LANGWATCH_API_KEY

