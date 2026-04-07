Feature: Evaluator CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage evaluators via CLI commands
  So that I can integrate evaluator management into my workflow without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List evaluators
    Given my project has evaluators configured
    When I run "langwatch evaluator list"
    Then I see a table of all evaluators with name, slug, and type

  Scenario: List evaluators when none exist
    Given my project has no evaluators
    When I run "langwatch evaluator list"
    Then I see a message indicating no evaluators were found

  Scenario: Get evaluator details by slug
    Given my project has an evaluator with slug "my-evaluator"
    When I run "langwatch evaluator get my-evaluator"
    Then I see evaluator metadata and configuration

  Scenario: Get evaluator details by ID
    Given my project has an evaluator with ID "evaluator_abc123"
    When I run "langwatch evaluator get evaluator_abc123"
    Then I see evaluator metadata and configuration

  Scenario: Get evaluator that does not exist
    When I run "langwatch evaluator get nonexistent"
    Then I see an error that the evaluator was not found

  Scenario: Create an evaluator
    When I run "langwatch evaluator create "My Evaluator" --type langevals/llm_judge"
    Then a new evaluator is created and I see confirmation with its name and slug

  Scenario: Create an evaluator without required type
    When I run "langwatch evaluator create "My Evaluator""
    Then I see an error that the --type option is required

  Scenario: Delete an evaluator
    Given my project has an evaluator with slug "my-evaluator"
    When I run "langwatch evaluator delete my-evaluator"
    Then the evaluator is archived and I see confirmation

  Scenario: Delete an evaluator that does not exist
    When I run "langwatch evaluator delete nonexistent"
    Then I see an error that the evaluator was not found

  Scenario: Run evaluator command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch evaluator list"
    Then I see an error prompting me to configure my API key
