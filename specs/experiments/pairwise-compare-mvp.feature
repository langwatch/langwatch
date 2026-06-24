Feature: Pairwise compare evaluator (MVP)
  # Issue: #5100
  # Parent epic: #5099
  #
  # Native pairwise LLM-as-judge for EvaluationsV3: given two prompt /
  # model variants and a golden reference, pick the better one per row
  # with position-bias mitigation (swap-and-confirm).

  Background:
    Given an EvaluationsV3 experiment with two prompt targets ("variant_a", "variant_b")
    And a dataset with rows having "input" and "expected_output" fields
    And each target has run on all rows producing outputs and metadata

  Scenario: Add a pairwise evaluator with all three fields
    When I add an evaluator of type "langevals/pairwise_compare"
    And I select target "variant_a" as Variant A
    And I select target "variant_b" as Variant B
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with the pairwise config

  Scenario: Run produces per-row verdicts
    Given a pairwise evaluator is configured with default settings
    When I run the evaluator
    Then for each row a row-level verdict result is produced
    And each result has a label in ("A", "B", "tie")
    And each result has a reasoning string

  Scenario: Position bias mitigation by default
    Given swap_and_confirm is true (default)
    When a row is evaluated
    Then the Python evaluator issues exactly 2 judge calls per row
    And when both calls agree, the agreed winner is returned
    And when they disagree, "tie" is returned

  Scenario: Aggregate header reflects tally
    Given 21 rows have been evaluated with verdicts: 12 A, 7 B, 2 tie
    When I view the aggregate header
    Then I see "A wins 12 · B wins 7 · Ties 2"
    And I see a "Bias-corrected" indicator

  Scenario: Copy as bug report on losing row
    Given a row where Variant B lost
    When I click "Copy as bug report" on that row
    Then the clipboard contains markdown with: input, output A, output B, golden, reasoning, winner

  Scenario: Filter chip — show losses
    Given Variant A is selected as the "current prod" baseline
    When I click "Losses (regressions)"
    Then only rows where the verdict is not "A" are shown
