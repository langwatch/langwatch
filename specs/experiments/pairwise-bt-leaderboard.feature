Feature: Pairwise compare — Bradley-Terry leaderboard aggregation
  # Issue: #5103
  # Parent epic: #5099
  # Depends on: #5100 (pairwise-compare-mvp.feature) AND
  #             #5101 (pairwise-nway-select-best.feature) — leaderboard is
  #             only meaningful with 3+ variants under comparison.
  #
  # Adds a Bradley-Terry MLE leaderboard panel for the pairwise / N-way
  # compare evaluator. Computes a transitive score per variant from
  # per-row verdicts, with 95% bootstrap CIs and a pairwise win-matrix
  # heatmap. Surfaced as a power-user panel inside the experiment view —
  # the existing AggregateHeaderBar win-rate display stays untouched.
  #
  # Gated end-to-end by feature flag
  # `release_ui_pairwise_bt_aggregation_enabled` (off by default). With
  # the flag off, every byte of the existing pairwise UI is identical to
  # today's behavior — no leaderboard panel mounts, no BT compute runs.

  Background:
    Given an EvaluationsV3 experiment with prompt targets ("variant_a", "variant_b", "variant_c", "variant_d")
    And a "langevals/pairwise_compare" evaluator configured in select_best mode across all four variants
    And the evaluator has produced verdicts on a multi-row run

  Scenario: Flag off — leaderboard panel is not mounted
    Given the feature flag "release_ui_pairwise_bt_aggregation_enabled" is OFF for the current project
    When I open the experiment view
    Then I do NOT see the Bradley-Terry leaderboard panel
    And the existing AggregateHeaderBar win-rate tally is rendered unchanged
    And no client-side BT MLE computation runs

  Scenario: Flag on — leaderboard renders alongside the existing aggregate header
    Given the feature flag "release_ui_pairwise_bt_aggregation_enabled" is ON for the current project
    When I open the experiment view
    Then I see the AggregateHeaderBar win-rate tally above the table
    And I see the "Leaderboard (Bradley-Terry, 95% CI)" panel below or beside the table
    And the panel header shows the total comparisons count and the minimum matchups per variant

  Scenario: Default sort is BT score descending
    Given the feature flag is ON and the leaderboard panel is rendered
    When the panel first mounts
    Then the rows are ordered by BT score, highest first
    And the rank column reads 1, 2, 3, ... top-down
    And degenerate variants (if any) appear at the bottom of the table

  Scenario: Each leaderboard row shows score, half-width CI, win rate, and matchup count
    Given the feature flag is ON and a healthy four-variant run with > 30 matchups per variant
    When the panel renders
    Then each row displays "<score> ± <half-CI>" with two decimals (e.g., "1.42 ± 0.18")
    And each row displays the win rate as an integer percentage
    And each row displays the matchup count "N"

  Scenario: Win-matrix heatmap is rendered with leaderboard ordering
    Given the feature flag is ON and the leaderboard panel is rendered
    When I look at the "Win matrix" section
    Then I see an NxN table with row and column headers matching the leaderboard order
    And cell (row=A, col=B) shows the number of rows where A beat B
    And the diagonal cells render as "—"
    And cells where (row wins / total) > 0.5 are tinted green
    And cells where (row wins / total) < 0.5 are tinted red

  Scenario: Sample-size warning fires when any variant has fewer than 30 matchups
    Given the feature flag is ON
    And variant_d has only 12 matchups while every other variant has at least 50
    When the panel renders
    Then a warning banner reads "Sample size low — at least one variant has fewer than 30 matchups. BT scores may be unstable."

  Scenario: No warning when every variant clears the sample-size threshold
    Given the feature flag is ON
    And every variant has at least 30 matchups
    When the panel renders
    Then no sample-size warning banner is shown

  Scenario: Degenerate variant — variant always wins
    Given the feature flag is ON
    And variant_a has won every comparison it was ever in (0 losses)
    When the panel renders
    Then variant_a's row is flagged "(degenerate)" next to its name
    And the row appears at the bottom of the table regardless of score
    And an info banner explains that MLE is undefined for variants with 0 wins or 0 losses
    And the panel does NOT crash and reports a finite score

  Scenario: Ties contribute 0.5 win + 0.5 loss to each side
    Given the feature flag is ON
    And 20 rows ended in a tie between variant_a and variant_b with no other comparisons
    When the panel renders
    Then variant_a's wins reads 10 and losses reads 10
    And variant_b's wins reads 10 and losses reads 10
    And variant_a's BT score equals variant_b's BT score within numerical tolerance

  Scenario: N-way "tie" rows are dropped (semantics ambiguous for N > 2)
    Given the feature flag is ON
    And one row recorded a "tie" across variant_a, variant_b, and variant_c (N=3)
    When the panel renders
    Then that row contributes zero weight to every pairwise cell in the win matrix
    And the comparisons count includes the row but no derived wins or losses from it

  Scenario: Rows with no winner (pending or error) are excluded
    Given the feature flag is ON
    And 5 rows have winner=null (pending or error)
    When the panel renders
    Then those rows do NOT contribute to wins, losses, or matchup counts
    And the comparisons count reflects only rows with a definite winner or explicit tie

  Scenario: Existing AggregateHeaderBar tally remains byte-identical when flag flips
    Given two experiment views — one with the flag OFF and one with the flag ON
    When both render against the same verdict dataset
    Then the AggregateHeaderBar win counts, tie count, filter chips, and promote buttons are identical
    And the only visible difference is the presence of the leaderboard panel
