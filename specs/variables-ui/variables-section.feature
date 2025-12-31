@unit
Feature: Variables section UI
  As a user configuring prompts or evaluations
  I want to manage input variables with a clean visual interface
  So that I can easily define and map variables to data sources

  Background:
    Given the Variables section is rendered

  # ============================================================================
  # Basic display
  # ============================================================================

  Scenario: Display section with "Variables" label
    Then the section header displays "Variables"
    And a "+" button is visible next to the header

  Scenario: Display existing variables with type icons
    Given a variable "question" of type "str" exists
    And a variable "count" of type "float" exists
    Then I see a variable row for "question" with a string type icon
    And I see a variable row for "count" with a number type icon

  # ============================================================================
  # Adding variables
  # ============================================================================

  Scenario: Add new variable
    When I click the "+" button
    Then a new variable row appears with a default name like "input"
    And the new variable has type "str" by default
    And the variable name field is focused for editing

  Scenario: Add variable with unique name
    Given a variable "input" already exists
    When I click the "+" button
    Then the new variable is named "input_1" to avoid duplicates

  # ============================================================================
  # Editing variable name
  # ============================================================================

  Scenario: Edit variable name by clicking
    Given a variable "question" exists
    When I click on the variable name "question"
    Then the name becomes an editable text field
    And the text is selected for easy replacement

  Scenario: Save variable name on blur
    Given I am editing the variable name
    And I have typed "user_input"
    When I click outside the name field
    Then the variable name is updated to "user_input"

  Scenario: Save variable name on Enter
    Given I am editing the variable name
    And I have typed "user_input"
    When I press Enter
    Then the variable name is updated to "user_input"

  Scenario: Cancel variable name edit on Escape
    Given a variable "question" exists
    And I am editing the variable name
    And I have typed "changed"
    When I press Escape
    Then the variable name remains "question"

  Scenario: Normalize variable names
    Given I am editing the variable name
    When I type "User Input"
    And I save the name
    Then the variable name is normalized to "user_input"

  Scenario: Prevent duplicate variable names
    Given a variable "question" exists
    And a variable "answer" exists
    When I try to rename "answer" to "question"
    Then an error message appears indicating duplicate name
    And the name is not changed

  # ============================================================================
  # Changing variable type
  # ============================================================================

  Scenario: Change variable type via dropdown
    Given a variable "question" of type "str" exists
    When I click on the type selector for "question"
    Then a dropdown appears with type options
    When I select "float"
    Then the variable type changes to "float"
    And the type icon updates to show a number icon

  # ============================================================================
  # Deleting variables
  # ============================================================================

  Scenario: Delete variable
    Given a variable "question" exists
    When I click the delete (x) button for "question"
    Then the variable "question" is removed from the list

  Scenario: Cannot delete when only one output exists
    Given the section is for "outputs"
    And only one output "result" exists
    Then the delete button for "result" is disabled
    And a tooltip explains "At least one output is required"

  # ============================================================================
  # Mapping UI (when showMappings=true)
  # ============================================================================

  Scenario: Show mapping input when mappings enabled
    Given showMappings is true
    And a variable "question" exists
    Then I see an "=" sign after the variable name
    And I see a mapping input field

  Scenario: Hide mapping input when mappings disabled
    Given showMappings is false
    And a variable "question" exists
    Then I do not see an "=" sign
    And I do not see a mapping input field

  Scenario: Mapping dropdown shows available sources
    Given showMappings is true
    And available sources include:
      | name               | type    | fields                    |
      | Test Data          | dataset | input, expected_output    |
      | GPT-4o Runner      | prompt  | output                    |
    When I click on the mapping input for variable "question"
    Then a dropdown appears with grouped sources
    And I see "Test Data" group with fields "input", "expected_output"
    And I see "GPT-4o Runner" group with field "output"

  Scenario: Select mapping from dropdown
    Given showMappings is true
    And a variable "question" exists with no mapping
    When I open the mapping dropdown
    And I select "input" from "Test Data"
    Then the mapping is set to source "Test Data", field "input"
    And the mapping input displays "Test Data.input"

  Scenario: Type default value in mapping input
    Given showMappings is true
    And a variable "question" exists
    When I type "Hello world" in the mapping input
    And no dropdown option is selected
    Then the variable has a default value of "Hello world"

  Scenario: Search filters mapping options
    Given showMappings is true
    And available sources have many fields
    When I type "output" in the mapping input
    Then only fields containing "output" are shown in the dropdown

  Scenario: Clear mapping
    Given a variable "question" has a mapping to "Test Data.input"
    When I clear the mapping input
    Then the mapping is removed
    And the variable has no mapping

  # ============================================================================
  # Read-only mode (for evaluator fields)
  # ============================================================================

  Scenario: Read-only variables cannot be renamed
    Given readOnly is true
    And a variable "output" exists
    Then clicking on the variable name does not make it editable

  Scenario: Read-only variables cannot be deleted
    Given readOnly is true
    And a variable "output" exists
    Then the delete button is not visible

  Scenario: Read-only variables cannot change type
    Given readOnly is true
    And a variable "output" of type "str" exists
    Then the type selector is disabled or not interactive

  Scenario: Read-only variables can still set mappings
    Given readOnly is true
    And showMappings is true
    And a variable "output" exists
    Then I can still interact with the mapping input
    And I can select a mapping source

  # ============================================================================
  # canAddRemove=false mode
  # ============================================================================

  Scenario: Cannot add variables when canAddRemove=false
    Given canAddRemove is false
    Then the "+" button is not visible

  Scenario: Cannot delete variables when canAddRemove=false
    Given canAddRemove is false
    And a variable "question" exists
    Then the delete button is not visible for any variable
