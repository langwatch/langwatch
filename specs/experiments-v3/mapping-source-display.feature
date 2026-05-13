Feature: Mapping source display names
  As a user mapping variables in Evaluations V3
  I want mapping sources to show the human-readable target name
  So that I can understand where a value comes from without decoding internal IDs

  Background:
    Given I have an evaluation workbench open
    And I have a prompt target named "category_classifier"
    And the prompt target produces an output field "l3"

  # ============================================================================
  # Source label resolution
  # ============================================================================

  @integration
  Scenario: Mapping a value from another target shows the target name not its ID
    Given I have an evaluator that maps "output" from the "category_classifier" target
    When I view the evaluator's variable mappings
    Then the "output" mapping shows "category_classifier.l3"
    And the "output" mapping does not show the raw target ID

  @integration
  Scenario: Source name falls back to the ID when no friendly name is known
    Given I have an evaluator that maps "output" from a target whose name has not loaded yet
    And the target's internal ID is "target_1778838627724"
    When I view the evaluator's variable mappings
    Then the "output" mapping shows the exact label "target_1778838627724.l3"

  @integration
  Scenario: Chaining one target into another shows the upstream target name
    Given I have a second prompt target that maps an input from "category_classifier"
    When I open the second target's variables panel
    Then the available source for that input is labelled "category_classifier"
    And it is not labelled with the internal target ID
