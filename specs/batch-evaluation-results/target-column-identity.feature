Feature: Target column identity on the results page
  As a user reading the results of an evaluation run
  I want each target column to name itself and to belong to the run
  So that I can tell two same-named columns apart and never read an empty one

  # A board can hold two targets with the identical stored name, for example
  # the same prompt added twice with a different configuration. The workbench
  # already tells them apart with a "(1)" / "(2)" suffix added at display time
  # (platform/app/src/experiments-v3/utils/variantDisambiguation.ts). The
  # results page must read the same way.
  #
  # A run also carries the whole board in its Targets snapshot, even when the
  # run was scoped to one column. The results page must render only the
  # targets the run holds data for.

  Background:
    Given I am on the experiment results page

  # ============================================================================
  # Column headers
  # ============================================================================

  @integration
  Scenario: Two target columns with the same name get separate headers
    Given a run with two targets both stored under the name "category_classifier"
    When the results table renders
    Then one target column header reads "category_classifier (1)"
    And the other target column header reads "category_classifier (2)"

  @integration
  Scenario: A target column with a unique name keeps its plain name
    Given a run with targets named "classifier" and "summarizer"
    When the results table renders
    Then the target column headers read "classifier" and "summarizer"

  @unit
  Scenario: The CSV export keeps a column block per same-named target
    Given a run with two targets both stored under the name "classifier"
    When I export the results to CSV
    Then the headers of the first target start with "classifier_(1)"
    And the headers of the second target start with "classifier_(2)"

  # ============================================================================
  # Chart axis labels
  # ============================================================================

  @integration
  Scenario: Two bars with the same target name keep their own axis labels
    Given a run with two targets both stored under the name "classifier"
    When the cost chart renders one bar per target
    Then the first bar is labelled "classifier (1)"
    And the second bar is labelled "classifier (2)"

  @integration
  Scenario: Two bars grouped under one prompt name keep their own axis labels
    Given a run with two targets that use different prompts named "classifier"
    When the cost chart groups its bars by prompt
    Then the first bar is labelled "classifier (1)"
    And the second bar is labelled "classifier (2)"

  # ============================================================================
  # Targets the run does not hold
  # ============================================================================

  @unit
  Scenario: A run scoped to one target renders only that target
    Given a run whose Targets snapshot lists "classifier" and "summarizer"
    And the run holds rows for "classifier" only
    When the results table renders
    Then only the "classifier" column is present

  @unit
  Scenario: A comparison column keeps its place though it owns no rows
    Given a run whose Targets snapshot lists a comparison evaluator as a target
    And the comparison holds a verdict for every row
    When the results table renders
    Then the comparison column is present

  @unit
  Scenario: A run that has produced no rows yet keeps every declared target
    Given a run whose Targets snapshot lists "classifier" and "summarizer"
    And the run holds no rows for either target
    When the results table renders
    Then both target columns are present
