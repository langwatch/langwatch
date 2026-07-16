Feature: Evaluation pass-rate consistency across surfaces
  As a platform user
  I want the pass rate shown on the Evaluations page cards to match the
  online-evaluations analytics dashboard
  So that I can trust either surface when deciding whether my product is healthy

  The Evaluations page renders one card per online evaluation with a headline
  pass rate over the selected period. The analytics dashboard renders a
  pass/fail donut and a pass-rate trend for the same evaluator over the same
  period. Both read the same evaluation runs, so they must agree.

  Two defects historically made them diverge:

  1. The timeseries parser defaulted every bucket missing a series value to 0.
     Average-type metrics (pass rate, score) are only missing when the
     evaluator produced no processed runs in that bucket, so the 0 fabricated
     a "0% pass rate" for days the evaluator never ran. An evaluator that ran
     on one of four active days with every run passing showed 25% instead of
     100%.

  2. The card headline averaged the daily bucket values with equal weight
     (an average of averages). The donut counts runs over the whole period
     (run-weighted). The card now reads a single full-period bucket for the
     headline, which is run-weighted by construction.

  Background:
    Given a project with online evaluations writing evaluation runs

  # ---------------------------------------------------------------------------
  # Parser: no fabricated values for average-type metrics
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Buckets without processed runs carry no pass-rate value
    Given a bucketed timeseries result for an average pass-rate series
    And the evaluator produced processed runs in only one bucket
    When the rows are parsed
    Then buckets without processed runs carry no value for the series
    And they do not report a 0% pass rate

  @unit
  Scenario: Count-type series still default missing buckets to zero
    Given a bucketed timeseries result with a run-count series and a pass-rate series
    And one bucket has no value for either series
    When the rows are parsed
    Then the run-count series defaults to 0 in that bucket
    And the pass-rate series stays absent in that bucket

  @unit
  Scenario: Grouped buckets follow the same fabrication rules
    Given a grouped timeseries result with a count series and an average score series
    And a group is present in a bucket with only the count value
    When the rows are parsed
    Then the count value is preserved
    And the average score stays absent for that group

  # ---------------------------------------------------------------------------
  # Monitor card: headline is the run-weighted pass rate for the whole period
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Card headline matches the analytics donut
    Given an online evaluation with 6 processed runs, all passed, on a single day
    And other evaluators produced runs on three other days in the period
    When the user opens the Evaluations page
    Then the evaluation card shows a 100% pass rate
    And the analytics donut for the same evaluator shows 100% passed

  @integration
  Scenario: Card headline weighs days by run volume
    Given an online evaluation with 1 of 10 runs passing on one day
    And 90 of 90 runs passing on another day
    When the user opens the Evaluations page
    Then the evaluation card shows the run-weighted pass rate of 91%
    And not the 55% average of the two daily rates

  @integration
  Scenario: Card shows no data when the evaluator never ran
    Given an online evaluation with no runs in the selected period
    When the user opens the Evaluations page
    Then the evaluation card shows a no-data placeholder instead of a percentage
