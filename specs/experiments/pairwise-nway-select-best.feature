Feature: Pairwise compare — select_best (N-way) mode
  # Issue: #5101
  # Parent epic: #5099
  # Depends on: #5100 (pairwise-compare-mvp.feature)
  #
  # Extends the pairwise MVP with a "Pick best of N" mode: 3+ candidate
  # outputs evaluated in a single judge call per row, with deterministic
  # randomize-order position-bias mitigation. The MVP 2-way path is
  # preserved unchanged when mode == "pairwise".

  Background:
    Given an EvaluationsV3 experiment with prompt targets ("variant_a", "variant_b", "variant_c", "variant_d")
    And a dataset with rows having "input" and "expected_output" fields
    And each target has run on all rows producing outputs and metadata

  Scenario: MVP pairwise mode behavior is preserved
    When I add an evaluator of type "langevals/pairwise_compare"
    And the mode toggle is on "A vs B" (default)
    And I select target "variant_a" as Variant A
    And I select target "variant_b" as Variant B
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with mode "pairwise" and variants ["variant_a", "variant_b"]
    And the Python evaluator issues exactly 2 judge calls per row (swap-and-confirm)

  Scenario: Pick best of N — configure 3 variants
    When I add an evaluator of type "langevals/pairwise_compare"
    And I toggle the mode to "Pick best of N"
    And I check "variant_a", "variant_b", and "variant_c"
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with mode "select_best" and variants of length 3
    And the helper text shows "3 variants selected · 1 judge call per row"

  Scenario: Pick best of N — fewer than 2 variants is invalid
    Given the mode toggle is on "Pick best of N"
    When only "variant_a" is checked
    Then the form shows the validation error "Select at least 2 variants."
    And the evaluator cannot be saved

  Scenario: Run produces a single winner per row
    Given a select_best evaluator is configured with 3 variants
    When I run the evaluator on a row
    Then exactly one judge call is issued for that row
    And the result label is either a variant id from the configured variants list, or "tie"
    And the result is NOT one of "A", "B", "C" (slot labels never leak)

  Scenario: Position-bias mitigation by deterministic shuffle
    Given a select_best evaluator with position_bias_mitigation unset
    When the same row (row_index = 42) is evaluated twice
    Then both runs render the candidates in the same shuffled order
    And the judge sees the same rendered prompt both times

  Scenario: Rows missing a variant output are silently skipped
    Given a select_best evaluator with 4 variants
    And one row where variant_d failed to produce an output
    When the run completes
    Then no synthetic Phase-2 cell is emitted for that row
    And no comparison verdict appears for that row in the table

  Scenario: Aggregate header tallies per variant
    Given 33 rows have been evaluated with verdicts
    And the per-variant wins are { variant_a: 12, variant_b: 7, variant_c: 9, variant_d: 3 } with 2 ties
    When I view the aggregate header
    Then I see "variant_a wins 12 · variant_b wins 7 · variant_c wins 9 · variant_d wins 3 · Ties 2"
    And I see one filter chip per variant plus "All" and "Losses (regressions)"
    And I see one "Promote {variant_id}" button per variant

  Scenario: Row verdict strip shows the variant id, not a slot label
    Given a select_best verdict where "variant_c" won row 5
    When I view the verdict strip for row 5
    Then I see "Pairwise verdict: variant_c"
    And the reasoning popover contains the judge's explanation

  Scenario: EvaluatorChip tints winner / loser / unrelated targets
    Given a select_best verdict where "variant_c" won row 5
    When I view row 5's target cells
    Then the variant_c chip is tinted "winner" (green)
    And the variant_a, variant_b, variant_d chips are tinted "loser" (red)
    And a chip belonging to a target NOT in the variants list shows no pairwise tint

  Scenario: Backward-compat — old 2-way configs read correctly
    Given an existing EvaluatorConfig stored with { variantA: "variant_a", variantB: "variant_b" } and no `variants` field
    When the orchestrator loads the config
    Then `normalizePairwiseConfig` returns { mode: "pairwise", variants: ["variant_a", "variant_b"], ... }
    And the orchestrator emits the same Phase-2 cells it would have before #5101

  Scenario: Switching mode trims or preserves variants
    Given the mode toggle is on "Pick best of N" with variants ["variant_a", "variant_b", "variant_c"]
    When I switch the toggle to "A vs B"
    Then the variants array is truncated to ["variant_a", "variant_b"]
    And switching back to "Pick best of N" leaves the truncated value alone (no re-expansion)
