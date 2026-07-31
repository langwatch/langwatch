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
  #
  # The scenarios tagged @unimplemented are the ones about what the card and
  # the drawer RENDER in detail — the heatmap, the trade-off scatter, the
  # expand affordance — for which there is no component test yet, tracked in
  # #6402. The two gates that decide whether any of it appears at all ARE
  # covered, and everything else is bound to a unit test.

  Background:
    Given an EvaluationsV3 experiment with target variants "variant_1", "variant_2", "variant_3"
    And a dataset with rows having "input" and "expected_output" fields
    And a Comparison evaluator has run across all rows, producing a verdict per row
    And my organization has the comparison leaderboard turned on

  # ── Who gets it at all ─────────────────────────────────────────────────
  #
  # Two gates, for two different reasons, and they must not be confused.
  # The ROLLOUT gate is per organization and temporary: it exists so this
  # ships dark and is switched on deliberately. The VARIANT-COUNT gate is a
  # permanent product rule — at two variants the win-rate chart already
  # tells the whole story.

  @integration
  Scenario: An organization without the leaderboard sees no trace of it
    Given my organization does not have the comparison leaderboard turned on
    When I view the run on the results page
    Then I do not see a leaderboard chart
    And the Metrics selector does not offer one
    # Both together, deliberately. Hiding the chart while leaving the menu
    # entry gives the reader a switch that turns nothing on, which is worse
    # than either state on its own.

  @integration
  Scenario: A shared leaderboard link opens nothing for an organization without it
    Given my organization does not have the comparison leaderboard turned on
    When I open a link that addresses the expanded leaderboard directly
    Then no leaderboard opens
    # The chart's expand affordance is the only way in, and it is already gone
    # — but the expanded view is addressable by URL, so a link shared out of an
    # organization that has the leaderboard would otherwise hand the whole
    # thing to one that has not been given it.

  @integration
  Scenario: The leaderboard chart appears once there are enough variants to rank
    Given the comparison has 3 variants
    When I view the run on the results page
    Then I see a leaderboard chart alongside the win-rate chart

  @integration @unimplemented
  Scenario: The leaderboard is offered without further opt-in
    When I view the run on the results page
    Then I see the leaderboard chart already enabled in the Metrics selector
    # Once the organization has it, there is no second switch: a ranking is
    # the point of running a Comparison across 3+ variants, so it is
    # pre-selected rather than left for the reader to discover.

  @integration
  Scenario: Two variants is a plain win-rate story, not a leaderboard
    Given the comparison has 2 variants
    When I view the run on the results page
    Then I do not see a leaderboard chart
    And I still see the win-rate chart

  @unit
  Scenario: The compact card ranks variants by Bradley-Terry score
    Given variant_1 has beaten variant_2 and variant_3 far more often than it has lost to them
    When I view the leaderboard chart
    Then variant_1 is ranked first
    And each variant shows its Bradley-Terry score

  @integration @unimplemented
  Scenario: Expanding the chart opens the full leaderboard
    Given I am viewing the compact leaderboard chart
    When I click its expand affordance
    Then a drawer opens with the full leaderboard table, the win-matrix heatmap, and the cost/duration view
    And the drawer is reachable by a shareable URL

  @unit
  Scenario: The leaderboard table shows a confidence interval per variant
    Given 40 rows have been evaluated across three variants
    When I open the expanded leaderboard
    Then each variant's score is shown with a 95% confidence interval
    And variants whose confidence intervals substantially overlap are shown as statistically indistinguishable, not strictly ordered

  @unit
  Scenario: A sample size too small to trust is called out
    Given one variant has fewer than 30 matchups
    When I open the expanded leaderboard
    Then I see a warning that the ranking may be unstable at this sample size

  # ── Claims the run is not entitled to make ─────────────────────────────
  #
  # Bradley-Terry has a unique answer only when the win graph is strongly
  # connected (Ford 1957). The per-variant check — did anyone sweep or get
  # swept — is necessary and not sufficient, and the gap is ordinary rather
  # than exotic: it is any field the run failed to knit together.

  @unit
  Scenario: A field that splits into tiers is not presented as one scale
    Given the top variants beat the bottom ones every time they met
    And every variant won at least once and lost at least once
    When I open the expanded leaderboard
    Then I am told the run did not connect all the variants onto one scale
    And I am told the size of a gap that spans the split is not measured
    # Without this the likelihood has no maximum, and the score is a readout
    # of the solver's iteration cap: 702 at five hundred iterations, 1302 at
    # a million, with a confidence interval that tightens around it as more
    # rows arrive.

  @unit
  Scenario: Variants that never met are not ordered against each other
    Given two variants were compared only with each other
    And two more were compared only with each other
    When I open the expanded leaderboard
    Then I am told the run splits into groups it never connected
    # Reachable in the ordinary way: the Comparison evaluator drops a
    # candidate that produced no output for a row.

  @unit
  Scenario: A ranking that cannot settle does not claim it has
    Given the run's variants do not all sit on one scale
    When I open the expanded leaderboard
    Then the ranking is not reported as having converged on a stable answer

  @unit
  Scenario: The last variant standing is not crowned by default
    Given one variant beat every other every time
    And one variant lost to every other every time
    And only one variant remains that can be scored
    When I read the headline
    Then it does not name a variant to ship
    # Both the sweeper and the swept are unscoreable, so the field collapses
    # to the one in the middle — which lost every match it played against the
    # sweeper shown at a 100% win rate two rows above.

  @unit
  Scenario: Variants the run separated are never called interchangeable
    Given the leader cannot be separated from two other variants
    But those two can be separated from each other
    When I read the headline
    Then it does not describe all three as too close to separate
    And the variants it does group agree with the separated-pair count

  @unit
  Scenario: A cheaper recommendation is measured against what I would ship
    Given the top-ranked variant is not the most expensive of the tied set
    And a cheaper variant is tied with it
    When I read the headline
    Then the saving is measured against the top-ranked variant
    # Measuring against the dearest tied variant instead inflates it: a field
    # of leader $0.002, other $0.010, cheapest $0.0018 reads as an 82% saving
    # when switching from the leader actually saves 10%.

  @unit
  Scenario: A cost averaged over too few rows does not drive the headline
    Given only one row recorded a cost for each variant
    When I read the headline
    Then it does not recommend a variant on price

  @unit
  Scenario: A variant that always wins is flagged, not left to break the math
    Given one variant has won every matchup it has been in
    When I open the expanded leaderboard
    Then that variant is marked as having insufficient contrary evidence
    And it is still shown with a finite score, sorted below variants with normal win/loss records

  @unit
  Scenario: Ties count as half a win and half a loss
    Given a row's verdict was a tie between variant_1 and variant_2
    When I open the expanded leaderboard
    Then that row contributes half a win and half a loss to both variants

  @unit
  Scenario: A three-way tie row is not counted in the leaderboard
    Given a row's verdict was a tie among all three variants
    When I open the expanded leaderboard
    Then that row does not contribute to any variant's score
    But it is still shown in the underlying Comparison column as a tie

  @unit
  Scenario: A skipped row contributes no evidence either way
    Given a row was skipped because a variant produced no output
    When I open the expanded leaderboard
    Then that row is excluded from every variant's matchup count

  @integration @unimplemented
  Scenario: The win-matrix heatmap shows who beat whom
    Given 40 rows have been evaluated across three variants
    When I open the expanded leaderboard
    Then I see a grid with one row and one column per variant
    And each cell shows how often the row variant beat the column variant, tinted by win rate

  @unit
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

  @unit
  Scenario: A matrix built from differing candidate sets keeps its pairwise reading
    Given some verdicts judged only a subset of the variants
    When I open the expanded leaderboard
    Then the win matrix is presented as head-to-head detail with no such caveat

  @integration @unimplemented
  Scenario: Clicking a win-matrix cell explains why
    Given variant_1 has beaten variant_2 on several rows
    When I click the cell where variant_1's row meets variant_2's column
    Then I see the judge's reasoning text for every row where they were compared and variant_1 won

  @integration @unimplemented
  Scenario: Cost and duration are shown as a tradeoff, not folded into the score
    Given the comparison's variants have different average cost and duration
    When I open the expanded leaderboard
    Then I see a chart plotting each variant's Bradley-Terry score against its average cost
    And I can switch that chart to plot against average duration instead
    And no single blended "best overall" score combines quality with cost or duration

  @unit
  Scenario: A cheaper variant that isn't meaningfully worse is visible at a glance
    Given variant_1 and variant_2 have overlapping confidence intervals
    And variant_2 costs substantially less than variant_1
    When I view the cost tradeoff chart
    Then variant_2 reads as a comparable-quality, lower-cost alternative to variant_1

  # ── All three metrics at once, and what they add up to ─────────────────
  #
  # Quality, cost and duration are the three things the decision turns on,
  # so the trade-off chart carries all three rather than two at a time.
  # The third rides on point size rather than a third spatial axis: depth
  # in a perspective projection cannot be read accurately, and a confidence
  # interval drawn into it could not be compared against another one at
  # all — which would hide the single thing that decides whether a quality
  # gap is real.
  #
  # Reading three metrics off a scatter is still work the reader should not
  # have to do. Whether one variant beats another outright has an exact
  # answer, so it is computed and stated, and the chart only confirms it.

  @integration @unimplemented
  Scenario: All three trade-off metrics are readable at once
    Given the comparison's variants have different average cost and duration
    When I view the trade-off chart
    Then each variant's point is positioned by its Bradley-Terry score and one of cost or duration
    And whichever of cost or duration is not on the axis is shown as the size of the point
    And the chart says what the point size means

  @integration @unimplemented
  Scenario: The quality axis carries its uncertainty
    Given the leaderboard has a confidence interval for each variant
    When I view the trade-off chart
    Then each point carries an error bar spanning that variant's confidence interval

  @unit
  Scenario: The cost axis carries its uncertainty too
    Given each variant's cost is an average over the rows it ran
    When I view the trade-off chart
    Then each point also carries a horizontal bar for how well that average is known
    And that bar describes where the true average lies, not how much individual rows varied

  @unit
  Scenario: A cost averaged over a single row admits it cannot be bounded
    Given a variant recorded a cost on exactly one row
    When I view the trade-off chart
    Then no horizontal bar is drawn for it
    And it is not drawn as though its cost were known exactly

  @unit
  Scenario: A variant beaten on every metric is named outright
    Given variant_1 scores distinguishably higher than variant_2
    And variant_1 costs meaningfully less than variant_2 and is meaningfully faster
    When I view the trade-off chart
    Then I am told variant_2 is beaten by variant_1 on quality, cost and speed
    And I do not have to compare any points myself to learn that

  @unit
  Scenario: Dominance is never claimed from a quality difference the run cannot see
    Given variant_1 and variant_2 have overlapping confidence intervals
    And variant_1 costs meaningfully less than variant_2 and is meaningfully faster
    When I view the trade-off chart
    Then variant_2 is not described as beaten on quality
    But variant_2 is still described as beaten on cost and speed

  @unit
  Scenario: A negligible cost or speed difference is not a win
    Given variant_1 and variant_2 cost within a rounding error of each other
    When I view the trade-off chart
    Then neither is described as the cheaper of the two

  @unit
  Scenario: Dominance is only claimed over metrics the run actually recorded
    Given no duration was recorded for any variant
    When I view the trade-off chart
    Then any dominance statement covers quality and cost only
    And speed is not named as something either variant won or lost on

  @unit
  Scenario: Cheaper and faster are decided per row, not on the averages
    Given two variants answered the same rows
    When the run decides whether one is cheaper or faster than the other
    Then it compares them within each row and asks whether the average difference excludes zero
    And a gap between their overall averages is not enough on its own

  @unit
  Scenario: A speed difference swamped by row-to-row variation is not claimed
    Given one variant averages several seconds faster than another
    But individual rows vary far more than that difference
    When I view the trade-off chart
    Then it is not described as faster
    And the dimensions it did win on are still named

  @unit
  Scenario: Two variants that share too few rows are not compared on cost
    Given both variants recorded a cost on enough rows of their own
    But they were priced on almost none of the same rows
    When I view the trade-off chart
    Then neither is described as cheaper than the other

  @unit
  Scenario: Asking about a pair in either order gives the same answer
    Given any two variants in the run
    When the run is asked which is cheaper, in both orders
    Then the two answers are mirror images
    And it can never hold that each is cheaper than the other

  # ── What a count across pairs does not mean ────────────────────────────

  @unit
  Scenario: The count of separated pairs states its own multiplicity
    Given the run separated some of several variant pairs
    When I read how much the run settled
    Then I am told each pair is judged on its own at 95%
    And I am told the chance that at least one of them separated by luck

  @unit
  Scenario: Margins of error built from unsettled fits say so
    Given many of the resamples used to size the margins of error did not settle
    When I view the trust panel
    Then I am told the margins are approximate
    And this is reported separately from whether the ranking itself settled

  @unit
  Scenario: A variant nothing beats outright is left for the reader to choose between
    Given no variant is beaten on every metric by another
    When I view the trade-off chart
    Then I am told the field presents a genuine trade-off rather than a variant to drop

  @integration @unimplemented
  Scenario: The leaderboard scales past a handful of variants
    Given the comparison has 10 variants
    When I open the expanded leaderboard
    Then the leaderboard table remains the primary, fully legible view regardless of variant count
    And the win-matrix heatmap is ordered by rank and scrolls rather than shrinking its cells past legibility

  @unit
  Scenario: Sample size gating matters more as variants grow
    Given the comparison has 10 variants and the same total row count as a 3-variant run
    When I open the expanded leaderboard
    Then more variants show the low-sample-size warning than would at 3 variants

  # ── Deciding whether two variants actually differ ──────────────────────
  #
  # Every claim in this feature — the winner, the tie set, what may be
  # dropped, how much the run settled — reduces to one question asked of a
  # pair. It is asked once, in one place, so the panels cannot disagree.
  #
  # It is asked of the DIFFERENCE between two scores, not of their two
  # separate intervals. Every resample fits all variants together, so their
  # errors move together; comparing the two intervals throws that pairing
  # away and asks a strictly harder question than the one being posed. The
  # result errs safe — it under-reports real differences — but under-
  # reporting is still being wrong, and it is wrong in a way that reads as
  # "we cannot tell you" when the run in fact could.

  @unit
  Scenario: Two variants are separated on the difference between them
    Given the run resampled the leaderboard many times
    When it decides whether two variants differ on quality
    Then it asks whether the confidence interval of their score difference excludes zero
    And not whether their two individual intervals happen to overlap

  @unit
  Scenario: A difference the run can see is not reported as a tie
    Given two variants whose individual confidence intervals overlap
    And whose score difference stays on one side of zero across the resamples
    When I view the leaderboard
    Then the run reports them as separated

  @unit
  Scenario: Every panel agrees on which pairs were separated
    Given a leaderboard with several variants
    When I read the verdict, the count of how much the run settled, and the trade-off summary
    Then all three rest on the same answer for any given pair

  @unit
  Scenario: Without resamples the run falls back to comparing intervals
    Given the bootstrap did not run
    When it decides whether two variants differ on quality
    Then it compares their individual intervals instead
    And it never reports more separation than that fallback allows

  # ── Reading the verdict without reading the chart ──────────────────────
  #
  # Everything decision-relevant is already computed: the winner, the tie
  # set, the cost gap. Stating it as a sentence costs nothing and cannot be
  # wrong, so it is stated in code rather than generated.

  @unit
  Scenario: The answer is one sentence, before any chart
    When I view the leaderboard
    Then I see a single sentence naming what to ship and why
    And that sentence is the same on the compact card and in the expanded drawer

  @unit
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

  @unit
  Scenario: How much longer the winner's answers were is reported
    Given the leading variant's outputs average far more characters than the other variants'
    When I open the expanded leaderboard
    Then I see how the leader's answer length compares to the rest of the field
    # Stated as a measurement, never as a warning. Longer genuinely is better
    # for some tasks, and a check that cries wolf gets ignored — which would
    # cost more than the bias it was meant to catch.

  @unit
  Scenario: Answer length is reported even when nothing is unusual
    Given every variant's outputs are of similar length
    When I open the expanded leaderboard
    Then I see that the leader's answers were of comparable length to the rest

  @unit
  Scenario: A judge that shares a model family with a candidate is disclosed
    Given the comparison was judged by "openai/gpt-5"
    And one of the candidate variants also runs on an OpenAI model
    When I open the expanded leaderboard
    Then I see that the judge and that candidate share a model family
    # Self-preference: a judge scores its own family's output higher. This
    # does not invalidate the run, but the reader has to know to discount it.

  @unit
  Scenario: A judge sharing a family with a variant that is not leading
    Given the judge shares a model family with a variant near the bottom
    When I view the trust panel
    Then I am told that variant's score may be flattered
    But I am not told to discount a lead it does not have

  @unit
  Scenario: A run with no leader says so rather than blaming missing text
    Given the run produced no single leader
    And every variant recorded its output text
    When I view the trust panel
    Then I am told there is no leader to compare answer lengths against
    And I am not told the output text was missing

  @unit
  Scenario: An independent judge is confirmed rather than left silent
    Given the comparison was judged by a model whose family no candidate uses
    When I open the expanded leaderboard
    Then I see that no candidate shares the judge's model family

  @unit
  Scenario: The judge model is the one that actually ran
    Given a run was judged by one model
    And the evaluator's configured model was changed afterwards
    When I open that run's expanded leaderboard
    Then the judge named is the one that judged that run, not the current configuration
    # The judge model is recorded onto the run at execution time for exactly
    # this reason. Reading the evaluator's live config would silently
    # misattribute every historical run.

  @unit
  Scenario: Sample size is reported as observed, never as a forecast
    When I open the expanded leaderboard
    Then I see how many comparisons the ranking is based on
    And I see how many variant pairs the run actually separated
    But I am not told how many more rows would produce a winner
    # A required-sample figure is a power calculation over an effect size
    # estimated from the same thin data. Promising "20 more will settle it"
    # is a promise the run cannot keep.

  # ── Axis labels ────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Every chart in the row labels the bars identically
    Given the run's variants are named "support-assistant-warm", "support-assistant-formal" and "support-assistant-blunt"
    When I view the results charts
    Then the cost, latency, win-rate and leaderboard charts show the same label for each variant

  @unit
  Scenario: Labels name the part that tells the variants apart
    Given every variant's name begins with the same long prefix
    When I view the results charts
    Then the shared prefix is elided and the distinguishing part of each name is shown
    # Truncating from the left throws away exactly the part that differs, so
    # every bar reads the same. Dropping the shared prefix removes the
    # collision at source instead of papering over it with "(1)" "(2)" "(3)".

  @unit
  Scenario: Names that already fit are shown in full
    Given the variants are named "gpt-5-mini" and "gpt-5-nano"
    When I view the results charts
    Then each bar shows its full name with no prefix elided
