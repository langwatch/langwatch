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

  Scenario: Confusion matrix mounts only once enough rows are annotated
    Given fewer than 5 of the 20 rows have an annotation
    When I view the results page Metrics
    Then the "Exact Match — agreement with reviewers" chart is not offered
    # Below a small floor, a 2x2 table is not a matrix, it's two anecdotes —
    # mirrors the BT leaderboard's low-sample-size framing rather than
    # inventing a new threshold philosophy.

  Scenario: Confusion matrix mounts once the annotation floor is met
    Given 12 of the 20 rows have an annotation
    When I view the results page Metrics
    Then the "Exact Match — agreement with reviewers" chart is offered
    And enabling it shows a compact 2x2 matrix card next to the other evaluator charts

  Scenario: Matrix cells count judge verdict against reviewer verdict
    Given 12 annotated rows: 5 judge-pass/reviewer-thumbsup, 1 judge-pass/reviewer-thumbsdown,
      2 judge-fail/reviewer-thumbsup, 4 judge-fail/reviewer-thumbsdown
    When I open the expanded confusion matrix
    Then I see "True Positive: 5", "False Positive: 1", "False Negative: 2", "True Negative: 4"
    And I see the row/column headers labeled "Judge: Pass / Fail" and "Reviewer: 👍 / 👎"

  Scenario: Unannotated rows are excluded, not treated as a verdict
    Given 8 of the 20 rows have no annotation at all
    When I open the expanded confusion matrix
    Then those 8 rows are not counted in any matrix cell
    And a coverage note reads "12 of 20 rows annotated"

  Scenario: A trace with conflicting annotations from multiple reviewers is excluded
    Given one annotated trace has two annotations that disagree (one thumbs up, one thumbs down)
    When I open the expanded confusion matrix
    Then that row is excluded from every matrix cell
    And the coverage note counts it separately as "1 row has conflicting reviewer annotations"

  Scenario: Derived metrics accompany the raw matrix
    Given the matrix in the prior scenario (5 TP, 1 FP, 2 FN, 4 TN)
    When I open the expanded confusion matrix
    Then I see "Accuracy: 75%", "Precision: 83%", "Recall: 71%", "F1: 77%"
    # (5+4)/12=75%, 5/(5+1)=83%, 5/(5+2)=71%, 2*.83*.71/(.83+.71)=77%

  Scenario: Clicking a matrix cell drills into the underlying rows
    Given the expanded confusion matrix is showing
    When I click the "False Positive" cell
    Then I see the list of rows where the judge said pass but the reviewer marked thumbs down
    And each row shows the target output and the reviewer's annotation comment, if any

  Scenario: Each pass/fail evaluator with enough annotation coverage gets its own matrix
    Given the experiment also has a second pass/fail evaluator "LLM Answer Match" with its own runs and annotations meeting the floor
    When I view the results page Metrics
    Then I see both "Exact Match — agreement with reviewers" and "LLM Answer Match — agreement with reviewers" as separate chart options

  Scenario: Feature flag gates the whole surface
    Given the "release_ui_judge_annotation_confusion_matrix_enabled" flag is off
    When I view the results page Metrics
    Then no confusion-matrix chart option is offered regardless of annotation coverage

  Scenario: Comparison evaluators are not offered a confusion matrix
    Given the experiment also has a 3-variant Comparison evaluator
    When I view the results page Metrics
    Then the Comparison evaluator is only offered its existing win-rate and leaderboard charts
    And it is not offered a confusion-matrix chart
    # Comparison judges pick a winner among variants, not a pass/fail verdict —
    # there is no "predicted class" to build a 2x2 matrix from.
