Feature: N-way compare evaluator (select best of N)
  # Issue: #5101
  # Parent epic: #5099
  #
  # Native "pick the best of N candidates" LLM-as-judge for EvaluationsV3.
  # A standalone evaluator, separate from Pairwise Compare (#5100) — shown
  # as its own card in Add Evaluator, not a mode toggle inside Pairwise
  # Compare. Given 3+ prompt / model variants and a golden reference, picks
  # the single best candidate per row in one judge call, with deterministic
  # candidate-order shuffling for position-bias mitigation.

  Background:
    Given an EvaluationsV3 experiment with target variants "variant_1", "variant_2", "variant_3"
    And a dataset with rows having "input" and "expected_output" fields
    And each target has run on all rows producing outputs and metadata

  Scenario: N-way Compare appears as its own evaluator card
    When I open Add Evaluator
    Then I see "N-way Compare" as a distinct card, separate from "Pairwise Compare"

  Scenario: Add an N-way Compare evaluator with three variants
    When I add an evaluator of type "langevals/select_best_compare"
    And I select targets "variant_1", "variant_2", "variant_3" as the variants to compare
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with the select-best config

  Scenario: At least two variants must be selected
    When I add an evaluator of type "langevals/select_best_compare"
    And I select only one variant
    Then the evaluator cannot be saved until a second variant is selected

  Scenario: Run produces one verdict per row from a single judge call
    Given an N-way Compare evaluator is configured with three variants and default settings
    When I run the evaluator
    Then for each row a row-level verdict result is produced from exactly one judge call
    And each result has a label equal to the winning candidate's identifier or "tie"
    And each result has a reasoning string

  Scenario: Candidate order is shuffled deterministically per row
    Given an N-way Compare evaluator is configured with five variants
    When the same row is evaluated twice
    Then the candidate order presented to the judge is identical both times

  Scenario: A row with a missing candidate output is skipped
    Given an N-way Compare evaluator is configured with three variants
    And one variant produced no output for a row
    When that row is evaluated
    Then no verdict is produced for that row

  Scenario: Column scoreboard reflects the per-variant tally
    Given 30 rows have been evaluated where variant_1 wins 14, variant_2 wins 10, variant_3 wins 4, and 2 ties
    When I view the N-way Compare column header
    Then I see the win tally broken down per variant, including ties

  Scenario: Adding N-way Compare does not affect existing Pairwise Compare evaluators
    Given an existing Pairwise Compare evaluator configured with "variant_1" and "variant_2"
    When I add a new N-way Compare evaluator alongside it
    Then the Pairwise Compare evaluator's configuration and results are unchanged
