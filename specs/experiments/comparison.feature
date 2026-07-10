Feature: Comparison evaluator (pairwise or multi-candidate preference judging)
  # Issues: #5100 (pairwise), #5101 (n-way), unified here
  # Parent epic: #5099
  #
  # One evaluator that compares 2 or more prior columns and picks the best
  # per row, against an optional golden reference. Comparing two candidates
  # is not a different feature from comparing five, so there is exactly one
  # "Comparison" card, one config form, and one result column.
  #
  # Supersedes the earlier split into "Pairwise Compare" and "N-way Compare"
  # cards. Backed by langevals/select_best_compare, which handles N=2.
  #
  # The legacy langevals/pairwise_compare evaluator remains runnable so that
  # experiments and monitors created before the merge keep working, but it is
  # no longer offered when creating something new.

  Background:
    Given an EvaluationsV3 experiment with target variants "variant_1", "variant_2", "variant_3"
    And a dataset with rows having "input" and "expected_output" fields
    And each target has run on all rows producing outputs and metadata

  Scenario: Comparison is offered as a single card
    When I open Add to Evaluation
    Then I see one "Comparison" card described as "Pairwise or multi-candidate preference judging"
    And I do not see a separate "Pairwise Compare" card
    And I do not see a separate "N-way Compare" card

  Scenario: Compare two variants
    When I add a Comparison evaluator
    And I select targets "variant_1", "variant_2" as the variants to compare
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with the comparison config
    And the comparison has 2 variants

  Scenario: Compare three variants
    When I add a Comparison evaluator
    And I select targets "variant_1", "variant_2", "variant_3" as the variants to compare
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with the comparison config
    And the comparison has 3 variants

  Scenario: At least two variants must be selected
    When I add a Comparison evaluator
    And I select only one variant
    Then the evaluator cannot be saved until a second variant is selected

  Scenario: Run produces one verdict per row from a single judge call
    Given a Comparison evaluator is configured with three variants and default settings
    When I run the evaluator
    Then for each row a row-level verdict result is produced from exactly one judge call
    And each result has a label equal to the winning candidate's identifier or "tie"
    And each result has a reasoning string

  Scenario: The verdict names only the winner
    Given a Comparison evaluator is configured with three variants
    And a row has been evaluated with "variant_2" winning
    When I view the Comparison column for that row
    Then I see "variant_2" named as the winner
    And I do not see the losing variants listed alongside it

  Scenario: Clicking the winner highlights its source column
    Given a Comparison verdict names "variant_2" as the winner
    When I click on the winner's name
    Then "variant_2"'s source column is highlighted and marked as having won
    And clicking the winner's name again clears the highlight

  Scenario: Candidate order is shuffled deterministically per row
    Given a Comparison evaluator is configured with five variants
    When the same row is evaluated twice
    Then the candidate order presented to the judge is identical both times

  Scenario: A row with a missing candidate output is skipped
    Given a Comparison evaluator is configured with three variants
    And one variant produced no output for a row
    When that row is evaluated
    Then no verdict is produced for that row
    And the row reports which variant it was waiting on

  Scenario: Column scoreboard reflects the per-variant tally
    Given 30 rows have been evaluated where variant_1 wins 14, variant_2 wins 10, variant_3 wins 4, and 2 ties
    When I view the Comparison column header
    Then I see the win tally broken down per variant, including ties

  # Customer feedback, 2026-07-08 call: reusing the same prompt as two
  # variants (e.g. re-testing gpt-4.1 vs gpt-5-mini) made them
  # indistinguishable in the scoreboard and per-row verdicts. What differs
  # between two same-name variants isn't always the model (could be
  # temperature, a prompt edit, anything) — so this doesn't guess a
  # differentiator, it just numbers them.
  Scenario: Same-name variants fall back to numbering
    Given two variants are both named "AI search system"
    When I view the Comparison column header or a row verdict
    Then the first is shown as "AI search system (1)"
    And the second is shown as "AI search system (2)"

  # Issue: #5378
  # Golden answer is opt-in, not mandatory — some datasets have no reference
  # answer, and picking a fake golden field (like "input") misframes the
  # judge prompt as golden-aware when it isn't.
  Scenario: Has Golden Answer is on by default
    When I add a Comparison evaluator
    Then Has Golden Answer is toggled on
    And a Golden field picker is shown

  Scenario: Turning off Has Golden Answer hides the Golden field picker
    Given a Comparison evaluator is configured with default settings
    When I toggle Has Golden Answer off
    Then no Golden field picker is shown
    And the evaluator can be saved without a golden field selected

  Scenario: Judge prompt drops golden framing when Has Golden Answer is off
    Given Has Golden Answer is toggled off
    And the prompt has not been customized by the user
    When a row is evaluated
    Then the rendered judge prompt contains no "golden answer" framing
    And the judge compares the candidates on their own merits

  Scenario: Judge prompt keeps golden framing when Has Golden Answer is on
    Given Has Golden Answer is toggled on (default)
    When a row is evaluated
    Then the rendered judge prompt asks the judge to compare the candidates against the golden answer

  Scenario: Structured outputs can be narrowed to a single field per variant
    Given "variant_1" produces a structured output with fields "answer" and "confidence"
    When I select "answer" as the output field to compare for "variant_1"
    Then only that field's value is presented to the judge as that candidate's output

  # Back-compat. Experiments created before the merge stored a two-slot
  # `pairwise` config (variantA / variantB) and, on older runs, verdict
  # labels of "A" / "B" rather than the winning candidate's identifier.
  # These are read and normalized on load; they are never written again.
  Scenario: A saved pairwise experiment loads as a Comparison
    Given a saved experiment whose evaluator carries the legacy pairwise config
    When I open the experiment
    Then it renders as a single Comparison column with 2 variants
    And re-running it produces verdicts without error

  Scenario: Legacy slot labels still name a winner
    Given a saved experiment with a stored verdict whose label is "A"
    When I view the Comparison column for that row
    Then the first variant is named as the winner

  Scenario: Existing pairwise monitors keep running
    Given a monitor configured with the legacy "langevals/pairwise_compare" evaluator
    When the monitor runs
    Then it evaluates successfully against the pairwise judge
