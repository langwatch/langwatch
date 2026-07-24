Feature: A failed run opens the node that failed
  As a user running a workflow until a node
  I want a failed run to surface the node that errored
  So that I see the actual error instead of a stale target output

  # Customer context: running "until here" on the End node opened the End node
  # and showed its previous output even when an upstream node (e.g. an LLM with
  # no messages) failed the run. The studio now focuses the node whose own
  # execution state is "error", falling back to the run target only when no
  # single node carries the error.

  @unit
  Scenario: An errored run opens the node that failed
    Given a run-until-here execution that ends in error
    And one upstream node carries the error
    When the workflow execution state change arrives
    Then the studio selects the failing node and expands its properties
    And it does not select the run target node
