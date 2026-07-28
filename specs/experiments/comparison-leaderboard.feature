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

  Scenario: A matrix with no pairwise information says so
    Given every verdict in the run judged all of the variants together
    When I open the expanded leaderboard
    Then I see that the counts along each row of the win matrix are identical
    And I am told those counts are the variant's total wins rather than a per-opponent tally
    And I am told the cell shading is still per pair
    # A Comparison judges the whole field at once, so one verdict makes the
    # winner beat every other variant simultaneously, and every count in a
    # winner's row is identical by construction. Reading "warm beats formal
    # specifically" off a 28 that only means "warm won 28 rows" is a wrong
    # decision waiting to happen.
    #
    # The shading is a different matter and the caveat must not dismiss it:
    # cells are tinted by w/(w+l) for that pair, so warm's 28-against-20 with
    # premium and 28-against-4 with formal shade differently, and that
    # difference is real head-to-head evidence. Point the reader at the
    # shading rather than writing the grid off.

  Scenario: A matrix built from differing candidate sets keeps its pairwise reading
    Given some verdicts judged only a subset of the variants
    When I open the expanded leaderboard
    Then the win matrix is presented as head-to-head detail with no such caveat

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

  # ── Reading the verdict without reading the chart ──────────────────────
  #
  # Everything decision-relevant is already computed: the winner, the tie
  # set, the cost gap. Stating it as a sentence costs nothing and cannot be
  # wrong, so it is stated in code rather than generated.

  Scenario: The answer is one sentence, before any chart
    When I view the leaderboard
    Then I see a single sentence naming what to ship and why
    And that sentence is the same on the compact card and in the expanded drawer

  Scenario: The headline never claims a winner the run cannot support
    Given the top two variants have overlapping confidence intervals
    And neither is meaningfully cheaper than the other
    When I read the headline
    Then it says the run does not separate them
    And it does not name either one as the winner

  # ── Judge biases the reader cannot see from the ranking ─────────────────
  #
  # The three documented failure modes of LLM-as-judge comparison are
  # position bias, verbosity bias and self-preference. Order is already
  # randomized per row. The other two are visible in data we already hold,
  # and invisible in a ranking, so they are reported alongside it.

  Scenario: How much longer the winner's answers were is reported
    Given the leading variant's outputs average far more characters than the other variants'
    When I open the expanded leaderboard
    Then I see how the leader's answer length compares to the rest of the field
    # Stated as a measurement, never as a warning. Longer genuinely is better
    # for some tasks, and a check that cries wolf gets ignored — which would
    # cost more than the bias it was meant to catch.

  Scenario: Answer length is reported even when nothing is unusual
    Given every variant's outputs are of similar length
    When I open the expanded leaderboard
    Then I see that the leader's answers were of comparable length to the rest

  Scenario: A judge that shares a model family with a candidate is disclosed
    Given the comparison was judged by "openai/gpt-5"
    And one of the candidate variants also runs on an OpenAI model
    When I open the expanded leaderboard
    Then I see that the judge and that candidate share a model family
    # Self-preference: a judge scores its own family's output higher. This
    # does not invalidate the run, but the reader has to know to discount it.

  Scenario: An independent judge is confirmed rather than left silent
    Given the comparison was judged by a model whose family no candidate uses
    When I open the expanded leaderboard
    Then I see that no candidate shares the judge's model family

  Scenario: The judge model is the one that actually ran
    Given a run was judged by one model
    And the evaluator's configured model was changed afterwards
    When I open that run's expanded leaderboard
    Then the judge named is the one that judged that run, not the current configuration
    # The judge model is recorded onto the run at execution time for exactly
    # this reason. Reading the evaluator's live config would silently
    # misattribute every historical run.

  Scenario: Sample size is reported as observed, never as a forecast
    When I open the expanded leaderboard
    Then I see how many comparisons the ranking is based on
    And I see how many variant pairs the run actually separated
    But I am not told how many more rows would produce a winner
    # A required-sample figure is a power calculation over an effect size
    # estimated from the same thin data. Promising "20 more will settle it"
    # is a promise the run cannot keep.

  # ── The optional written explanation ───────────────────────────────────

  Scenario: The written explanation is opt-in, not automatic
    When I open the expanded leaderboard
    Then no model has been called to describe the result
    And I see a control offering to explain the result in prose

  Scenario: The explanation is a conversation with Langy, not a paragraph in the panel
    When I ask for the result to be explained
    Then the question opens in Langy with the computed result already in it
    And nothing generated is rendered inside the result panel itself
    # Two reasons. Generated prose sitting inside the panel carries the same
    # visual authority as the computed verdict beside it, which is how a
    # fluent wrong answer gets acted on. And a reader who disagrees, or wants
    # to know what to change, can push back on a conversation but not on a
    # frozen paragraph.

  Scenario: The question carries the computed conclusion
    When I ask for the result to be explained
    Then Langy is given the scores, intervals, costs and checks that were already computed
    And it is asked to explain that conclusion rather than to rank the variants again
    # Langy could go and re-derive a ranking from the run. A second ranking
    # that disagrees with the one on screen is worse than no explanation.

  Scenario: A reader who cannot start a Langy conversation is not offered one
    Given I do not have permission to start a Langy conversation
    When I open the expanded leaderboard
    Then I am not offered the explain control
    And I still see the full computed result

  # ── Axis labels ────────────────────────────────────────────────────────

  Scenario: Every chart in the row labels the bars identically
    Given the run's variants are named "support-assistant-warm", "support-assistant-formal" and "support-assistant-blunt"
    When I view the results charts
    Then the cost, latency, win-rate and leaderboard charts show the same label for each variant

  Scenario: Labels name the part that tells the variants apart
    Given every variant's name begins with the same long prefix
    When I view the results charts
    Then the shared prefix is elided and the distinguishing part of each name is shown
    # Truncating from the left throws away exactly the part that differs, so
    # every bar reads the same. Dropping the shared prefix removes the
    # collision at source instead of papering over it with "(1)" "(2)" "(3)".

  Scenario: Names that already fit are shown in full
    Given the variants are named "gpt-5-mini" and "gpt-5-nano"
    When I view the results charts
    Then each bar shows its full name with no prefix elided
