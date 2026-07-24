Feature: Lazy-loaded evaluation inputs in the trace drawer
  As an operator inspecting an evaluation in the trace drawer
  I want the evaluator inputs loaded only when I open a specific evaluation
  So that heavy input payloads never block the verdict list or blow memory

  # The verdict list shows scores immediately, but evaluator inputs can be
  # multi-megabyte. They're fetched per-evaluation on expand, keyed by the
  # evaluation id (the ClickHouse sort key) so the read prunes granules
  # instead of scanning every evaluation the trace touches.

  @integration
  Scenario: Inputs load on demand when an evaluation is expanded
    Given a trace evaluation whose inputs were not loaded with the verdict list
    When I open that evaluation's details in the drawer
    Then the evaluator inputs are fetched for that single evaluation and shown

  @integration
  Scenario: Inputs already present are shown without an extra request
    Given a trace evaluation whose verdict list already includes its inputs
    When I open that evaluation's details in the drawer
    Then the inputs are shown without fetching them again

  @unit
  Scenario: A single evaluation's inputs can be fetched without scanning the trace
    Given an evaluation whose trace-wide inputs read is too heavy
    When the inputs are requested for that one evaluation
    Then the read is keyed by the evaluation id so it stays within memory
