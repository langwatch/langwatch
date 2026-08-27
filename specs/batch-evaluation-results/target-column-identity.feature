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
