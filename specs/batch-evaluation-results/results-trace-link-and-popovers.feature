Feature: Evaluation results trace links and detail popovers
  As a user analyzing evaluation results
  I want trace links that resolve and detail popovers that survive scrolling
  So that I can inspect intermediate steps and evaluator reasoning without dead ends

  # Customer context from a call: (1) "view trace" on a workflow-evaluate
  # run spun and ended in "Trace not found"; (2) the evaluator score
  # popover disappeared as soon as the results table scrolled, and its
  # content could not be scrolled to read long reasoning.

  Background:
    Given I am logged in
    And an experiment has evaluation results

  # ============================================================================
  # Trace links from workflow evaluate runs
  # ============================================================================

  @integration @unimplemented
  Scenario: Result rows from a workflow evaluate run link to a resolvable trace
    Given a workflow was published and evaluated via the studio Evaluate button
    When I open a result row's trace from the results table
    Then the trace details load successfully
    And the trace shows the workflow execution spans including intermediate steps

  @integration @unimplemented
  Scenario: Rows without a stored trace do not offer a dead trace link
    Given a result row whose execution produced no stored trace
    Then the row does not render a "view trace" affordance

  # ============================================================================
  # Evaluator detail popover behavior under scroll
  # ============================================================================

  @unimplemented
  Scenario: Evaluator details popover stays attached while the table scrolls
    Given an evaluator score popover is open on a result row
    When I scroll the results table
    Then the popover either follows its anchor row or closes cleanly
    And it never lingers detached over unrelated rows

  @unimplemented
  Scenario: Long evaluator reasoning is scrollable inside the popover
    Given an evaluator result with reasoning longer than the popover height
    When I open the score details popover
    Then the popover content scrolls internally
    And I can read the full reasoning without the popover closing
