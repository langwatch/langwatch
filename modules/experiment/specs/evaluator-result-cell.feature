Feature: Readable evaluator result cells
  @integration
  Scenario: Evaluator verdicts are readable without opening JSON
    Given evaluator outputs with passed, failed, scored, skipped and error results
    When the results table renders their cells
    Then each cell shows its status, score and details where available
    And failed cells have a visible failure accent

  @integration
  Scenario: The full evaluator result remains available
    Given a failed evaluator result with details and extra fields
    When I open JSON in its cell
    Then I can read the complete result including the extra fields
    And I can close JSON again

  @integration
  Scenario: Ordinary target output is not treated as an evaluator verdict
    Given a prompt output containing passed and score fields
    When the results table renders its cell
    Then it retains its original JSON presentation
