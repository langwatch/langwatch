Feature: Structured outputs section in the prompt editor
  As a user configuring a prompt (standalone, in evaluations, or as a workflow node)
  I want the outputs to be configurable in a visible section below the inputs
  So that I can find and shape structured outputs without hunting inside the model selector

  # Customer context: during a call the user could not find where to
  # rename the output to "score" / add "reasoning" — the only path was
  # clicking the model chip and toggling structured outputs inside the
  # popover. The code block already shows an Outputs section in its
  # panel; prompts must offer the same affordance. The model-selector
  # popover section stays (same state, two views).

  Background:
    Given I am logged in
    And I have a prompt open in the prompt editor drawer

  # ============================================================================
  # Outputs section placement and behavior
  # ============================================================================

  @integration @unimplemented
  Scenario: Outputs section renders below the inputs section
    Then I see an "Outputs" section below the "Inputs" section
    And it lists the prompt's current outputs with their types

  @integration @unimplemented
  Scenario: Adding an output from the section enables structured outputs
    Given the prompt has the default single "output" of type str
    When I add an output "reasoning" of type str from the Outputs section
    Then the prompt now produces structured outputs with "output" and "reasoning"
    And the model-selector popover shows structured outputs enabled

  @integration @unimplemented
  Scenario: Renaming and retyping an output from the section
    Given the prompt has an output "output" of type str
    When I rename it to "score" and change its type to float
    Then the saved prompt config has a float output named "score"

  @integration @unimplemented
  Scenario: Outputs edited in the model selector reflect in the section
    When I add an output "label" via the model selector's structured outputs editor
    Then the Outputs section below the inputs lists "label" too

  @integration @unimplemented
  Scenario: Outputs section appears in the workflow prompt node drawer
    Given a signature node open in the optimization studio drawer
    Then the node's outputs are editable in an Outputs section below the inputs
    And changes propagate to the node's output handles on the canvas

  # ============================================================================
  # Inputs section affordances
  # ============================================================================

  @integration @unimplemented
  Scenario: Inputs section shows the Add button in the prompt editor
    Then the "Inputs" section shows an "Add" button
    And clicking it lets me add a new typed input variable

  @integration @unimplemented
  Scenario: Input added via the Add button is usable in the template
    When I add an input "query" of type str via the Add button
    Then "{{query}}" is a valid variable in the prompt template
    And it is no longer flagged as missing
