@regression
Feature: Inline evaluator settings survive the Studio to engine dispatch
  As a user tuning a judge directly on the Optimization Studio canvas
  I want the settings I typed into the panel to reach the evaluator endpoint
  So that the run I see on the canvas is the run the evaluator actually performed

  # The two ends of the hop were tested separately, so neither test could see
  # that they disagreed on the wire shape. The browser flattens the panel's
  # settings into one parameter per key; the engine read only a single
  # `settings` parameter, found none, and dispatched an empty settings map.
  # The endpoint then merged its way down to the saved evaluator's defaults
  # and the canvas edits silently did nothing.

  Background:
    Given an Optimization Studio workflow with one evaluator node
    And the evaluator panel's settings are flattened into the node parameters

  @integration
  Scenario: A saved evaluator with unsaved panel edits dispatches those edits
    Given the node references a saved evaluator and carries unsaved panel edits
    When the Studio dispatches the run to the engine
    Then the evaluate call targets the saved evaluator's path
    And the evaluate call carries every setting the panel showed

  @integration
  Scenario: An inline evaluator node dispatches the settings on the node
    Given the node references an evaluator slug with its settings on the node
    When the Studio dispatches the run to the engine
    Then the evaluate call targets the slug's path
    And the evaluate call carries every setting the panel showed

  # The dispatch reads a handful of identifiers off the node's parameters in
  # their own right. One of them, `name`, is also a setting the two competitor
  # evaluators declare, holding the company being defended, and the panel has
  # nowhere else to write it. Treating the identifier as reserved would run
  # those two on the schema default instead of the canvas value.
  @integration
  Scenario: A competitor evaluator dispatches the company name the panel showed
    Given the node references a competitor evaluator naming a company to defend
    When the Studio dispatches the run to the engine
    Then the evaluate call carries that company among its settings
