@unit
Feature: Judge Quality Analysis
  As a user of LangWatch who uses LLM-as-judge evaluators
  I want to measure the reliability of my evaluators against human annotations
  So that I can know whether to trust my evaluation scores

  Background:
    Given I have a project with evaluator "Answer Correctness"
    And at least 10 traces have both a judge score and a human annotation score
    for evaluator "Answer Correctness"

  # ============================================================================
  # Access
  # ============================================================================

  Scenario: Judge Quality tab appears on evaluator detail page
    Given evaluator "Answer Correctness" has 10 or more annotated traces
    When I open evaluator "Answer Correctness"
    Then I see a "Judge Quality" tab alongside the configuration tab

  Scenario: Judge Quality tab is hidden when insufficient annotations exist
    Given evaluator "Answer Correctness" has fewer than 10 annotated traces
    When I open evaluator "Answer Correctness"
    Then I do not see a "Judge Quality" tab
    And I see a prompt: "Annotate at least 10 traces to unlock judge quality analysis"

  # ============================================================================
  # Confusion Matrix
  # ============================================================================

  Scenario: Confusion matrix is displayed
    When I open the "Judge Quality" tab for evaluator "Answer Correctness"
    Then I see a 2x2 confusion matrix with cells:
      | cell           | description                                |
      | True Positive  | Judge passed, human annotated pass         |
      | False Positive | Judge passed, human annotated fail         |
      | False Negative | Judge failed, human annotated pass         |
      | True Negative  | Judge failed, human annotated fail         |
    And each cell shows a count of matching traces

  Scenario: Clicking a confusion matrix cell shows matching traces
    Given the confusion matrix shows 4 False Positives
    When I click the "False Positive" cell
    Then I see a list of the 4 traces where the judge passed but human annotated fail
    And each trace links to its trace detail view

  # ============================================================================
  # Reliability Metrics
  # ============================================================================

  Scenario: Reliability metrics are computed from the confusion matrix
    When I open the "Judge Quality" tab
    Then I see the following metrics:
      | metric         | description                                              |
      | Precision      | TP / (TP + FP) — of judge passes, how many were correct  |
      | Recall         | TP / (TP + FN) — of actual passes, how many did judge catch |
      | F1 Score       | Harmonic mean of Precision and Recall                    |
      | Accuracy       | (TP + TN) / total — overall correct predictions          |
      | Agreement Rate | % of traces where judge and human reached the same verdict |

  Scenario: Metrics update when new annotations are added
    Given the Judge Quality tab shows Precision of 0.80
    When a new annotation is added that contradicts a judge pass
    Then the Precision value updates to reflect the new annotation

  # ============================================================================
  # Coverage Indicator
  # ============================================================================

  Scenario: Coverage indicator shows annotation completeness
    Given evaluator "Answer Correctness" has scored 200 traces
    And 25 of those traces have human annotations
    When I open the "Judge Quality" tab
    Then I see "25 / 200 traces annotated (12.5% coverage)"

  # ============================================================================
  # Performance Over Time
  # ============================================================================

  Scenario: Metrics trend chart is shown when multiple evaluation runs exist
    Given evaluator "Answer Correctness" has run across 3 different date ranges
    And some runs used different evaluator versions
    When I open the "Judge Quality" tab
    Then I see a timeseries chart showing Precision, Recall, and F1 over time
    And each data point is labelled with its evaluator version
    And I can identify whether a recent prompt change improved or degraded reliability

  Scenario: No trend chart when only one evaluation run exists
    Given evaluator "Answer Correctness" has only one evaluation run
    When I open the "Judge Quality" tab
    Then I do not see a timeseries chart
    And I see a message: "Run more evaluations over time to see performance trends"

  # ============================================================================
  # Data scoping
  # ============================================================================

  Scenario: Analysis is scoped to the current project
    Given I am in project "Project A"
    And project "Project B" has annotations for the same evaluator
    When I open the "Judge Quality" tab
    Then I only see annotations from "Project A"
    And Project B data does not affect the confusion matrix counts, coverage, or trend chart

  Scenario: Analysis compares judge score pass/fail against annotation thumbs up/down
    Given a trace where the judge classified the result as pass
    And the same trace has a human annotation of thumbs down
    Then this trace is counted as a False Positive in the confusion matrix
