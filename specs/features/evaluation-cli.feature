Feature: Evaluation CLI Commands
  As a developer running evaluations from the command line
  I want to execute and monitor evaluation runs via CLI
  So that I can run evaluations in CI/CD pipelines and from agent workflows

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: Run an evaluation by slug
    Given my project has an evaluation configured with slug "quality-check"
    When I run "langwatch evaluation run quality-check"
    Then the evaluation starts and I see the run ID and total cell count

  Scenario: Run an evaluation and wait for completion
    Given my project has an evaluation configured with slug "quality-check"
    When I run "langwatch evaluation run quality-check --wait"
    Then I see progress updates as cells complete
    And I see a summary when the evaluation finishes

  Scenario: Run an evaluation with JSON output
    Given my project has an evaluation configured with slug "quality-check"
    When I run "langwatch evaluation run quality-check -f json"
    Then I see raw JSON with the run ID and status

  Scenario: Check evaluation run status
    Given an evaluation run with ID "run_abc123" exists
    When I run "langwatch evaluation status run_abc123"
    Then I see the run status, progress, and timing

  Scenario: Check evaluation run status as JSON
    Given an evaluation run with ID "run_abc123" exists
    When I run "langwatch evaluation status run_abc123 -f json"
    Then I see raw JSON with status, progress, and summary

  Scenario: Run evaluation that does not exist
    When I run "langwatch evaluation run nonexistent-slug"
    Then I see an error that the evaluation was not found

  Scenario: Run evaluation command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch evaluation run quality-check"
    Then I see an error prompting me to configure my API key
