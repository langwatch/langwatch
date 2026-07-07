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
    And each result has a label equal to the winning candidate's identifier or "tie"
    And each result has a reasoning string

  Scenario: Position bias mitigation by default
    Given swap_and_confirm is true (default)
    When a row is evaluated
    Then the Python evaluator issues exactly 2 judge calls per row
    And when both calls agree, the agreed winner is returned
    And when they disagree, "tie" is returned

  Scenario: Column scoreboard reflects tally
    Given 21 rows have been evaluated where variant_a wins 12, variant_b wins 7, and 2 ties
    When I view the Pairwise Compare column header
    Then I see "variant_a wins 12 · 2 ties" with the full breakdown in the tooltip

  # Issue: #5378
  # Golden answer is opt-in, not mandatory — some datasets have no
  # reference answer, and picking a fake golden field (like "input")
  # misframes the judge prompt as golden-aware when it isn't.
  Scenario: Has Golden Answer is on by default
    When I add an evaluator of type "langevals/pairwise_compare"
    Then Has Golden Answer is toggled on
    And a Golden field picker is shown

  Scenario: Turning off Has Golden Answer hides the Golden field picker
    Given a pairwise evaluator is configured with default settings
    When I toggle Has Golden Answer off
    Then no Golden field picker is shown
    And the evaluator can be saved without a golden field selected

  Scenario: Judge prompt drops golden framing when Has Golden Answer is off
    Given Has Golden Answer is toggled off
    And the prompt has not been customized by the user
    When a row is evaluated
    Then the rendered judge prompt contains no "golden answer" framing
    And the judge compares Candidate A and Candidate B on their own merits

  Scenario: Judge prompt keeps golden framing when Has Golden Answer is on
    Given Has Golden Answer is toggled on (default)
    When a row is evaluated
    Then the rendered judge prompt asks the judge to compare both candidates against the golden answer
