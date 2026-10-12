Feature: Expand a truncated LLM message in the DSPy run table
  As a user reviewing a DSPy optimizer run
  I want to see a truncated Messages cell's full content
  So that I don't have to guess at what got cut off

  # Issue #503. The Messages cell always truncates long prompts
  # (collapseStringsAfterLength), so the cell itself never overflows its box —
  # HoverableBigText's usual hover-to-expand affordance never fires here. An
  # explicit expand button sidesteps that instead of fighting it, reusing the
  # same ExpandedTextDialog the batch-evaluation results table already uses.

  Background:
    Given a DSPy optimizer run with a step whose LLM call has a long prompt

  @integration
  Scenario: Expanding a truncated Messages cell shows the full prompt
    When I view the step's LLM calls table
    And I click the Messages cell's expand button
    Then a dialog opens showing the full, pretty-printed prompt
