Feature: Evaluation history grouping in trace details
  As a user viewing trace evaluations
  I want evaluation re-runs grouped by evaluator
  So that I see the latest result without confusing duplicates

  Background:
    Given I am viewing the evaluations tab of a trace
    And the trace has an evaluator "Toxicity Check" that ran 3 times
    And each re-run was triggered by new spans arriving on the trace
    And the most recent run passed with score 0.95
    And the previous run passed with score 0.8
    And the oldest run failed with score 0.3

  # ============================================================================
  # Default view: grouped, showing latest result only
  # ============================================================================

  @integration
  Scenario: Evaluator with multiple runs shows only the latest result
    Then I see a single entry for "Toxicity Check"
    And it displays the result from the most recent run
    And I see the score 0.95 and passed status

  @integration
  Scenario: Evaluator with a single run shows normally without history indicator
    Given the trace also has an evaluator "PII Detection" that ran only once
    Then I see a single entry for "PII Detection"
    And there is no history indicator on "PII Detection"

  # ============================================================================
  # History indicator
  # ============================================================================

  @integration
  Scenario: Evaluator with multiple runs shows a history indicator
    Then the "Toxicity Check" entry shows a history indicator
    And the indicator conveys that 2 previous runs exist

  # ============================================================================
  # Expanding history
  # ============================================================================

  @e2e
  Scenario: Expanding history shows previous runs
    When I click the history indicator on "Toxicity Check"
    Then the entry expands to show all 3 runs
    And the runs are ordered from most recent to oldest
    And each run shows its own score, status, and timestamp

  @e2e
  Scenario: Collapsing history hides previous runs
    Given I expanded the history for "Toxicity Check"
    When I click the history indicator again
    Then only the latest result is visible

  # ============================================================================
  # Multiple evaluators with history
  # ============================================================================

  @integration
  Scenario: Multiple evaluators each group independently
    Given the trace also has an evaluator "Faithfulness" that ran 2 times
    Then I see 2 grouped entries: "Toxicity Check" and "Faithfulness"
    And each shows only its latest result
    And each has its own independent history indicator

  # ============================================================================
  # Guardrails tab uses the same grouping
  # ============================================================================

  @integration
  Scenario: Guardrail evaluations are also grouped by evaluator
    Given the trace has a guardrail evaluator "Content Filter" that ran 2 times
    When I view the guardrails tab
    Then "Content Filter" shows as a single grouped entry with history indicator

  # ============================================================================
  # Edge cases
  # ============================================================================

  @integration
  Scenario: Evaluations without an evaluator identifier show individually
    Given the trace has evaluations submitted via API without an evaluator identifier
    Then each appears as an individual ungrouped entry
    And they show no history indicator

  @integration
  Scenario: Evaluation counts badge reflects grouped results
    Then the evaluations tab badge counts unique evaluators not individual runs
    And failed/error status is based on the latest run of each evaluator

  @integration
  Scenario: History includes error states
    Given the most recent run of "Toxicity Check" has status "error"
    And the previous run passed with score 0.8
    Then the latest entry shows the error state
    And expanding history shows the previous successful run
