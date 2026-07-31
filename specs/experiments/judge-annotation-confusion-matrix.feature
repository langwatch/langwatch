# Issue: none filed yet — ad-hoc follow-up to the Comparison evaluator's
# Bradley-Terry leaderboard (#5103). That feature ranks 3+ variants against
# each other; this one is for the other evaluator shape — a single pass/fail
# (guardrail-style) judge — where "who's better" doesn't apply, but "is this
# judge trustworthy" does.
#
# The confusion matrix compares the judge's own verdict (`passed`) against an
# independent ground truth: a human reviewer's annotation on the SAME target
# output the judge scored. LangWatch already has a full annotation system
# (thumbs up/down on a trace) — this feature is the first thing to actually
# aggregate it against automated judge verdicts, rather than just showing an
# annotation count chip on one trace at a time.
#
# No new dataset schema or evaluator config is needed: every experiments-v3
# target execution already gets a real, dereferenceable trace id, and
# `annotation.getByTraceIds` already exists to bulk-fetch human annotations
# for a batch of trace ids.

Feature: Judge-vs-annotation confusion matrix
  A results-page chart showing whether a pass/fail evaluator's automated
  verdict agrees with human reviewers who annotated the same target output.

  Background:
    Given an EvaluationsV3 experiment with a pass/fail evaluator "Exact Match"
    And the evaluator has run on 20 rows against target "support-agent"
    And each row's target execution has a real trace id
    And a human reviewer has left a thumbs up/down annotation on 12 of those traces

  @integration
  Scenario: Confusion matrix mounts only once enough rows are annotated
    Given fewer than 5 of the 20 rows have an annotation
    When I view the results page Metrics
    Then the "Exact Match vs reviewers — support-agent" chart is not offered
    # Below a small floor, a 2x2 table is not a matrix, it's two anecdotes —
    # mirrors the BT leaderboard's low-sample-size framing rather than
    # inventing a new threshold philosophy.

  @integration
  Scenario: Confusion matrix mounts once the annotation floor is met
    Given 12 of the 20 rows have an annotation
    When I view the results page Metrics
    Then the "Exact Match vs reviewers — support-agent" chart is offered
    And enabling it shows a compact 2x2 matrix card next to the other evaluator charts

  @unit
  Scenario: Matrix cells count judge verdict against reviewer verdict
    Given 12 annotated rows: 5 judge-pass/reviewer-thumbsup, 1 judge-pass/reviewer-thumbsdown,
      2 judge-fail/reviewer-thumbsup, 4 judge-fail/reviewer-thumbsdown
    When I open the expanded confusion matrix
    Then I see "True Positive: 5", "False Positive: 1", "False Negative: 2", "True Negative: 4"
    And I see the row/column headers labeled "Judge: Pass / Fail" and "Reviewer: 👍 / 👎"

  @unit
  Scenario: Unannotated rows are excluded, not treated as a verdict
    Given 8 of the 20 rows have no annotation at all
    When I open the expanded confusion matrix
    Then those 8 rows are not counted in any matrix cell
    And a coverage note reads "12 of 20 rows annotated"

  @unit
  Scenario: A trace with conflicting annotations from multiple reviewers is excluded
    Given one annotated trace has two annotations that disagree (one thumbs up, one thumbs down)
    When I open the expanded confusion matrix
    Then that row is excluded from every matrix cell
    And the coverage note counts it separately as "1 row has conflicting reviewer annotations"

  @unit
  Scenario: Derived metrics accompany the raw matrix
    Given the matrix in the prior scenario (5 TP, 1 FP, 2 FN, 4 TN)
    When I open the expanded confusion matrix
    Then I see "Accuracy: 75%", "Precision: 83%", "Recall: 71%", "F1: 77%"
    # (5+4)/12=75%, 5/(5+1)=83%, 5/(5+2)=71%, 2*.83*.71/(.83+.71)=77%

  @unit
  Scenario: A judge that only matches the base rate scores zero agreement
    Given 10 annotated rows where the reviewer marked 9 as thumbs up
    And the judge answered "pass" on every one of them
    When I open the expanded confusion matrix
    Then the accuracy reads 90%
    But the chance-corrected agreement reads 0.00
    And the agreement is described as "none"
    # This is the whole reason a second number exists. A judge that has
    # learned nothing scores 90% on this set purely off the base rate;
    # accuracy alone would call that a success.

  @unit
  Scenario: Accuracy is reported with the range it could plausibly be
    Given 8 annotated rows of which the judge got 6 right
    When I open the expanded confusion matrix
    Then the accuracy reads 75%
    And it is accompanied by a 95% interval of roughly 41% to 93%
    And a warning explains the sample cannot yet separate a good judge from a bad one
    # A point estimate off 8 rows reads far more settled than it is. The
    # warning keys off the WIDTH of that interval, not a row count — the
    # chart already refuses to mount below its own row floor, so a
    # count-based warning could never fire.

  @integration
  Scenario: Agreement is shown against the level chance alone would reach
    Given any matrix with enough annotated rows to mount
    When I open the expanded confusion matrix
    Then I see the observed accuracy plotted against the chance-agreement floor
    And the confidence interval is drawn at the same scale
    # Drawn, not just tabulated: a base-rate judge should be visibly
    # swallowed by the chance floor, and a thin sample should read as a
    # wide smear rather than a crisp number.

  @unit
  Scenario: Undefined agreement is reported as undefined, not as perfect
    Given every annotated row was marked thumbs up by the reviewer
    And the judge answered "pass" on every one of them
    When I open the expanded confusion matrix
    Then the chance-corrected agreement reads "—"
    And it is described as undefined rather than as perfect agreement
    # Chance agreement is already total here, so the correction divides by
    # zero. Reporting 1.00 would dress a degenerate case up as a triumph.

  @integration
  Scenario: The reader is told the annotated rows may not be representative
    Given the annotated rows were chosen by reviewers browsing for problems
    When I open the expanded confusion matrix
    Then I am told the figures describe only the annotated rows
    And I am warned they may not generalise to the full run
    # The sharpest limitation of this whole chart. LangWatch annotations are
    # left ad hoc — reviewers thumbs-down what catches their eye — so the
    # annotated set skews toward suspicious rows. No confidence interval
    # fixes a biased sample; the honest move is to say so on the surface.

  @integration
  Scenario: Clicking a matrix cell drills into the underlying rows
    Given the expanded confusion matrix is showing
    When I click the "False Positive" cell
    Then I see the list of rows where the judge said pass but the reviewer marked thumbs down
    And each row shows the target output and the reviewer's annotation comment, if any

  @unit
  Scenario: A note left without a verdict is not shown as the reviewer's reasoning
    Given an annotated trace also carries an annotation with a comment but no thumbs up/down
    When I drill into the cell containing that row
    Then the comment shown is the one left alongside the verdict being scored
    # A verdict-less note ("parking this, will look again tomorrow") is not the
    # reviewer's rationale for the thumbs up/down in the matrix, and presenting
    # it as one puts words in their mouth.

  @integration
  Scenario: The expanded view opened from a link explains itself instead of breaking
    Given I paste a link to the expanded confusion matrix into a fresh tab
    When the page loads
    Then I am told the view is built from the run on the results page and to reopen it from there
    And no matrix is drawn
    # The drawer is URL-routed but its data travels in memory, so the ids
    # survive a reload and the data does not.

  @integration
  Scenario: A run with no comparable rows says so rather than showing an empty matrix
    Given no row has both a resolved judge verdict and an agreed reviewer annotation
    When I open the expanded confusion matrix
    Then I am told there is nothing to compare yet
    And no 2x2 table of zeroes is drawn
    # Four cells reading "0 · 0%" present the absence of a measurement as a
    # measurement.

  @integration
  Scenario: Each pass/fail evaluator with enough annotation coverage gets its own matrix
    Given the experiment also has a second pass/fail evaluator "LLM Answer Match" with its own runs and annotations meeting the floor
    When I view the results page Metrics
    Then I see both "Exact Match vs reviewers — support-agent" and "LLM Answer Match vs reviewers — support-agent" as separate chart options

  @integration
  Scenario: No confusion matrix is offered when comparing multiple runs
    Given the results page is comparing two runs side by side
    When I view the results page Metrics
    Then no confusion-matrix chart option is offered
    # The matrix scores one run's judge against reviewers of that run's
    # traces. Multi-run compare mode is out of scope for v1 — the feature
    # withdraws rather than silently scoring only the first run.

  @integration
  Scenario: Feature flag gates the whole surface
    Given the "release_ui_judge_annotation_confusion_matrix_enabled" flag is off
    When I view the results page Metrics
    Then no confusion-matrix chart option is offered regardless of annotation coverage

  @integration
  Scenario: Comparison evaluators are not offered a confusion matrix
    Given the experiment also has a 3-variant Comparison evaluator
    When I view the results page Metrics
    Then the Comparison evaluator is only offered its existing win-rate and leaderboard charts
    And it is not offered a confusion-matrix chart
    # Comparison judges pick a winner among variants, not a pass/fail verdict —
    # there is no "predicted class" to build a 2x2 matrix from.
