Feature: Mapping Validation and Missing Mapping Detection
  As a user creating evaluations
  I want to be alerted when required mappings are missing
  So that I can fix them before running evaluations

  Background:
    Given I have an evaluation workbench open
    And I have a dataset with columns "input, expected_output"

  # ============================================================================
  # Runner Header Alert
  # ============================================================================

  Scenario: Runner header shows alert icon when mapping is missing
    Given I have a runner with input field "question"
    And "question" is not mapped for the active dataset
    Then the runner header shows a pulsing alert icon

  Scenario: Runner header hides alert when all mappings are set
    Given I have a runner with input field "question"
    And "question" is mapped to "input" for the active dataset
    Then the runner header does not show an alert icon

  Scenario: Alert icon updates when switching datasets
    Given I have two datasets
    And I have a runner with mappings for dataset 1 but not dataset 2
    When I switch to dataset 2
    Then the runner header shows a pulsing alert icon

  # ============================================================================
  # Drawer Highlights
  # ============================================================================

  @integration
  Scenario: Opening drawer shows missing mapping warning
    Given I have a runner with missing mappings
    When I click to open the runner's drawer
    Then I see a warning message about missing mappings
    And the unmapped fields are visually highlighted

  Scenario: Highlighting clears after mapping is set
    Given I have the drawer open with highlighted missing mappings
    When I set a mapping for a highlighted field
    Then that field is no longer highlighted as missing

  # ============================================================================
  # Required vs Optional Fields
  # ============================================================================

  Scenario: Only required fields trigger missing mapping warnings
    Given I have a runner with:
      | field   | required | mapped |
      | input   | yes      | no     |
      | context | no       | no     |
    Then the runner header shows alert for "input" only
    And "context" does not trigger a warning

  Scenario: Value mappings count as mapped
    Given I have a runner with input "question"
    And "question" has a value mapping "Hello world"
    Then "question" is not considered missing

  # ============================================================================
  # Per-Runner Run Button Validation
  # ============================================================================

  Scenario: Run button validates mappings before execution
    Given I have a runner with missing mappings
    When I click the run button for that runner
    Then the drawer opens automatically
    And missing fields are highlighted

  Scenario: Run button proceeds when all mappings are set
    Given I have a runner with all mappings set
    When I click the run button for that runner
    Then the evaluation starts (or mock run triggers)

  # ============================================================================
  # Global Run Evaluation Button
  # ============================================================================

  Scenario: Global run validates all runners and evaluators
    Given I have multiple runners
    And runner 2 has missing mappings
    When I click the global "Run Evaluation" button
    Then the drawer opens for runner 2
    And missing fields are highlighted

  Scenario: Global run validates in order
    Given I have runners with missing mappings:
      | runner   | missing_fields |
      | Runner 1 | question       |
      | Runner 2 | context        |
    When I click the global "Run Evaluation" button
    Then the drawer opens for "Runner 1" first

  Scenario: Global run validates evaluators too
    Given I have a runner with all mappings set
    And the runner has an evaluator with missing mappings
    When I click the global "Run Evaluation" button
    Then the evaluator drawer opens
    And missing fields are highlighted

  # ============================================================================
  # Evaluator Validation
  # ============================================================================

  Scenario: Evaluator shows missing mapping alert on runner cell
    Given I have an evaluator with missing mappings for a runner
    Then the evaluator chip on that runner's cell shows an alert

  Scenario: Clicking evaluator chip opens with highlights
    Given I have an evaluator with missing mappings
    When I click the evaluator chip on a runner cell
    Then the evaluator drawer opens
    And the missing mappings are highlighted

  # ============================================================================
  # Adding an Evaluator with Unmapped Required Fields
  # ============================================================================
  #
  # Auto-inference cannot always satisfy every required input (e.g. an evaluator
  # needs an "expected_output" the dataset does not carry). When that happens on
  # ADD, silently closing the picker leaves the user with a freshly-added
  # evaluator and no signpost to where the missing mapping lives. Instead the
  # evaluator's mapping drawer opens straight onto the unmapped fields.

  Scenario: Adding an evaluator with unmapped required fields opens its mapping drawer
    Given the active dataset and runner cannot satisfy an evaluator's required input
    When I add that evaluator to the workbench
    Then the evaluator's mapping drawer opens automatically
    And the unmapped required fields are highlighted
    And the picker does not silently close without guiding me

  Scenario: Adding an evaluator whose required fields all auto-map closes the picker
    Given I add an evaluator whose required inputs are all auto-mapped
    Then the picker closes
    And the evaluator's mapping drawer does not open

  # ============================================================================
  # Declared-but-unused prompt variables
  # ============================================================================
  #
  # Every prompt is born with an "input" variable, and deleting the "{{input}}"
  # reference from the template never removes the declaration. A mapping is
  # required only when the template proves the prompt consumes the variable.

  @regression @unit
  Scenario: A declared input the template does not use needs no mapping
    Given I have a prompt target whose messages reference "{{brand}}" and "{{product_name}}"
    And "input" is still a declared variable on the prompt
    And "input" is not mapped for the active dataset
    Then "input" is not reported as a missing required mapping
    And the experiment can run without mapping "input"

  @regression @integration
  Scenario: The column header stays quiet for a declared input the template does not use
    Given I have a prompt target whose messages reference "{{brand}}" and "{{product_name}}"
    And "brand" and "product_name" are mapped for the active dataset
    And "input" is declared but unmapped
    Then the column header shows no alert icon
    And the column play button starts the run

  @regression @unit
  Scenario: A declared prompt variable that IS referenced still requires a mapping
    Given I have a prompt target whose user message references "{{product_name}}"
    And "product_name" is a declared variable on the prompt
    And "product_name" is not mapped for the active dataset
    Then "product_name" is reported as a missing required mapping

  @regression @integration
  Scenario: The column header warns for a referenced variable that is unmapped
    Given I have a prompt target whose user message references "{{product_name}}"
    And "product_name" is not mapped for the active dataset
    Then the column header shows a pulsing alert icon
    And the column play button opens the prompt editor instead of running

  # With no template turn to render, the engine sends the declared variables as
  # the user turn, so each of them reaches the model and needs a value.
  @regression @unit
  Scenario: A prompt with no user or assistant message needs every declared variable
    Given I have a prompt target whose template has only a system message
    And "input" and "product_name" are declared variables on the prompt
    Then both variables are reported as missing required mappings

  @regression @unit
  Scenario: A prompt target with no loaded template requires nothing
    Given I have a prompt target that follows the latest version with no local edits
    And its saved template has not loaded yet
    Then no variable is reported as a missing required mapping
    And the experiment can run
