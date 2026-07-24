Feature: Branch convergence in workflow DAGs
  As a user building workflows
  I want mutually exclusive branches to converge back onto one input
  So that an If/Else fork can pick a path and still reach a single end output

  # Customer context: an If/Else fork is only useful if the branches can
  # rejoin. People expect "decide between two paths, then land on the same
  # output" - that is the whole point of a workflow having one end. Today
  # the canvas blocks the second edge into an input with "Cannot connect
  # two values to the same input", so a fork can never converge.
  #
  # The rule is about who can run together, not about edge counts. Two
  # sources may share one input only when they can never both produce a
  # value in the same run - i.e. they sit on opposite sides of the same
  # If/Else gate. Sources that can run at the same time (two independent
  # nodes, or two outputs of one node) stay blocked, because the engine
  # would have to silently pick a winner. The engine already skips the
  # not-taken branch, so a converged input deterministically carries the
  # value of whichever branch actually ran.

  Background:
    Given I am logged in
    And I have a workflow open in the optimization studio

  # ============================================================================
  # Authoring: which connections are allowed
  # ============================================================================

  @integration
  Scenario: Mutually exclusive branch outputs can converge on one input
    Given an if/else gate with a node on its true branch and a node on its false branch
    When I connect both branch nodes to the same end input
    Then both connections are accepted
    And the end input keeps an edge from each branch

  @integration
  Scenario: Concurrent outputs cannot converge on one input
    Given two nodes that both always run
    And one of them is already connected to an end input
    When I connect the other node to that same end input
    Then the connection is rejected
    And the error explains that only mutually exclusive branches can share an input

  @integration
  Scenario: Two outputs of the same node cannot converge on one input
    Given a node whose output is connected to an end input
    When I connect another output of the same node to that same input
    Then the connection is rejected

  @integration
  Scenario: A nested fork still converges on a shared input
    Given an outer if/else gate and an inner if/else gate on its true branch
    And a node on each leaf branch of the nested fork
    When I connect every leaf node to the same end input
    Then all of the connections are accepted

  # ============================================================================
  # Execution: a converged input is deterministic
  # ============================================================================

  @integration
  Scenario: A converged input receives the value from whichever branch ran
    Given an if/else fork whose two branches both feed the same end input
    When the workflow runs and the true branch is taken
    Then the end input holds the true branch's value
    And the skipped false branch contributes nothing to that input
