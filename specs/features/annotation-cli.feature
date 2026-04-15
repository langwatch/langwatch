Feature: Annotation CLI Commands
  As a developer reviewing LLM trace quality
  I want to manage annotations via CLI commands
  So that I can provide feedback on traces without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List all annotations
    Given my project has annotations
    When I run "langwatch annotation list"
    Then I see a table of annotations with ID, trace ID, comment, rating, and time

  Scenario: List annotations filtered by trace
    When I run "langwatch annotation list --trace-id trace_abc123"
    Then I see only annotations for the specified trace

  Scenario: List annotations as JSON
    When I run "langwatch annotation list -f json"
    Then I see raw JSON array of annotation objects

  Scenario: Get annotation details
    Given my project has an annotation with ID "ann_123"
    When I run "langwatch annotation get ann_123"
    Then I see annotation details including comment, rating, trace ID, and timestamps

  Scenario: Create annotation with thumbs up
    When I run "langwatch annotation create trace_abc123 --comment 'Great response!' --thumbs-up"
    Then a new annotation is created and I see confirmation

  Scenario: Create annotation with thumbs down
    When I run "langwatch annotation create trace_abc123 --comment 'Incorrect answer' --thumbs-down"
    Then a new annotation is created with negative feedback

  Scenario: Delete an annotation
    Given my project has an annotation with ID "ann_123"
    When I run "langwatch annotation delete ann_123"
    Then the annotation is deleted and I see confirmation

  Scenario: Run annotation command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch annotation list"
    Then I see an error prompting me to configure my API key
