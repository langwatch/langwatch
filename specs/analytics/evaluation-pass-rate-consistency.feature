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

  1. Days where an evaluator produced no processed runs were reported as a 0%
     pass rate instead of no data. An evaluator that ran on one of four active
     days with every run passing showed 25% instead of 100%.

  2. The card headline averaged the daily rates with equal weight (an average
     of averages), while the donut counts runs over the whole period. The card
     now shows the run-weighted rate over the whole period, matching the donut
     even when run volume differs wildly between days.

  Background:
    Given a project with online evaluations writing evaluation runs

  # ---------------------------------------------------------------------------
  # Days without runs are "no data", never a fabricated value
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Days without evaluations show no pass rate instead of a fabricated 0%
    Given an evaluator with processed runs on only one day of the period
    And other evaluators ran on the remaining days
    When the pass-rate data for the period is read
    Then days without processed runs carry no pass-rate value
    And no day reports a 0% pass rate the evaluator never produced

  @unit
  Scenario: Days without evaluations still count zero runs
    Given a chart showing both a run count and a pass rate
    And one day has no runs at all
    When the data for the period is read
    Then that day counts 0 runs
    And that day carries no pass-rate value

  @unit
  Scenario: Grouped charts keep zero counts without inventing scores
    Given a chart grouped by evaluation result showing run counts and average scores
    And one group has runs but no score values
    When the data for the period is read
    Then the group keeps its run count
    And the group carries no average score

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
