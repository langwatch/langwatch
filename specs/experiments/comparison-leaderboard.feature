Feature: Comparison leaderboard (Bradley-Terry ranking on the results page)
  # Issue: #5103 ("Bradley-Terry leaderboard aggregation")
  # Parent epic: #5099 (closed) — built on top of specs/experiments/comparison.feature
  # (#5528, the unified "Comparison" evaluator).
  #
  # A win-rate tally ("variant_1 wins 14, variant_2 wins 10") is fine for a
  # quick read, but it breaks down once there are enough variants that
  # transitivity stops being guaranteed (A beats B, B beats C, C beats A on a
  # smaller sample) and opponent strength stops being equal. Bradley-Terry MLE
  # — the same math LMSYS Chatbot Arena moved to in place of incremental Elo —
  # fits every variant a single strength score from all its matchups at once,
  # with a bootstrap confidence interval so the ranking's own uncertainty is
  # visible rather than implied.
  #
  # This lives on the RESULTS PAGE (a saved, completed run), not the live
  # workbench — it is read-only analysis of verdicts that have already
  # happened, alongside the existing Cost / Latency / Win-Rate charts.
  #
  # Ported from a stale draft (PR #5118) that implemented the Bradley-Terry
  # engine and a presentational leaderboard panel but never wired either one
  # to real data. The math (computeBTLeaderboard) is unchanged; everything
  # about connecting it to a real run's verdicts, and every UI decision below,
  # is new.

  Background:
    Given an EvaluationsV3 experiment with target variants "variant_1", "variant_2", "variant_3"
    And a dataset with rows having "input" and "expected_output" fields
    And a Comparison evaluator has run across all rows, producing a verdict per row

  Scenario: The leaderboard is offered without any opt-in
    When I view the run on the results page
    Then I see the leaderboard chart already enabled in the Metrics selector
    # No feature flag: a ranking is the point of running a Comparison across
    # 3+ variants, so it ships on. Variant count is the only gate, and it is a
    # product rule rather than a rollout one — see the scenario below.

  Scenario: The leaderboard chart appears once there are enough variants to rank
    Given the comparison has 3 variants
    When I view the run on the results page
    Then I see a leaderboard chart alongside the win-rate chart

  Scenario: Two variants is a plain win-rate story, not a leaderboard
    Given the comparison has 2 variants
    When I view the run on the results page
    Then I do not see a leaderboard chart
    And I still see the win-rate chart

  Scenario: The compact card ranks variants by Bradley-Terry score
    Given variant_1 has beaten variant_2 and variant_3 far more often than it has lost to them
    When I view the leaderboard chart
    Then variant_1 is ranked first
    And each variant shows its Bradley-Terry score

  Scenario: Expanding the chart opens the full leaderboard
    Given I am viewing the compact leaderboard chart
    When I click its expand affordance
    Then a drawer opens with the full leaderboard table, the win-matrix heatmap, and the cost/duration view
    And the drawer is reachable by a shareable URL

  Scenario: The leaderboard table shows a confidence interval per variant
    Given 40 rows have been evaluated across three variants
    When I open the expanded leaderboard
    Then each variant's score is shown with a 95% confidence interval
    And variants whose confidence intervals substantially overlap are shown as statistically indistinguishable, not strictly ordered

  Scenario: A sample size too small to trust is called out
    Given one variant has fewer than 30 matchups
    When I open the expanded leaderboard
    Then I see a warning that the ranking may be unstable at this sample size

  Scenario: A variant that always wins is flagged, not left to break the math
    Given one variant has won every matchup it has been in
    When I open the expanded leaderboard
    Then that variant is marked as having insufficient contrary evidence
    And it is still shown with a finite score, sorted below variants with normal win/loss records

  Scenario: Ties count as half a win and half a loss
    Given a row's verdict was a tie between variant_1 and variant_2
    When I open the expanded leaderboard
    Then that row contributes half a win and half a loss to both variants

  Scenario: A three-way tie row is not counted in the leaderboard
    Given a row's verdict was a tie among all three variants
    When I open the expanded leaderboard
    Then that row does not contribute to any variant's score
    But it is still shown in the underlying Comparison column as a tie

  Scenario: A skipped row contributes no evidence either way
    Given a row was skipped because a variant produced no output
    When I open the expanded leaderboard
    Then that row is excluded from every variant's matchup count

  Scenario: The win-matrix heatmap shows who beat whom
    Given 40 rows have been evaluated across three variants
    When I open the expanded leaderboard
    Then I see a grid with one row and one column per variant
    And each cell shows how often the row variant beat the column variant, tinted by win rate

  Scenario: Clicking a win-matrix cell explains why
    Given variant_1 has beaten variant_2 on several rows
    When I click the cell where variant_1's row meets variant_2's column
    Then I see the judge's reasoning text for every row where they were compared and variant_1 won

  Scenario: Cost and duration are shown as a tradeoff, not folded into the score
    Given the comparison's variants have different average cost and duration
    When I open the expanded leaderboard
    Then I see a chart plotting each variant's Bradley-Terry score against its average cost
    And I can switch that chart to plot against average duration instead
    And no single blended "best overall" score combines quality with cost or duration

  Scenario: A cheaper variant that isn't meaningfully worse is visible at a glance
    Given variant_1 and variant_2 have overlapping confidence intervals
    And variant_2 costs substantially less than variant_1
    When I view the cost tradeoff chart
    Then variant_2 reads as a comparable-quality, lower-cost alternative to variant_1

  Scenario: The leaderboard scales past a handful of variants
    Given the comparison has 10 variants
    When I open the expanded leaderboard
    Then the leaderboard table remains the primary, fully legible view regardless of variant count
    And the win-matrix heatmap is ordered by rank and scrolls rather than shrinking its cells past legibility

  Scenario: Sample size gating matters more as variants grow
    Given the comparison has 10 variants and the same total row count as a 3-variant run
    When I open the expanded leaderboard
    Then more variants show the low-sample-size warning than would at 3 variants
