@unit
Feature: Variable insertion menu
  As a user writing prompts
  I want to easily insert variables referencing data sources
  So that I can build dynamic prompts with proper mappings

  Background:
    Given a prompt textarea is rendered
    And available sources include:
      | name               | type    | fields                              |
      | Test Data          | dataset | input, expected_output              |
      | Web research agent | prompt  | output_text, output_parsed          |
      | Workflow Input     | dataset | input_as_text                       |

  # ============================================================================
  # Opening the menu via {{ trigger
  # ============================================================================

  Scenario: Typing {{ opens the insertion menu
    Given the textarea is focused
    When I type "Hello {{"
    Then the variable insertion menu appears
    And the menu is positioned near the cursor

  Scenario: Typing { alone does not open menu
    Given the textarea is focused
    When I type "Hello {"
    Then the variable insertion menu does not appear

  Scenario: Typing {{ at start of textarea
    Given the textarea is empty and focused
    When I type "{{"
    Then the variable insertion menu appears

  # ============================================================================
  # Menu content and structure
  # ============================================================================

  Scenario: Menu shows search input
    Given the insertion menu is open
    Then I see a search input at the top of the menu

  Scenario: Menu shows sources grouped by name
    Given the insertion menu is open
    Then I see sources grouped under their names
    And I see "Test Data" as a group header
    And I see "Web research agent" as a group header
    And I see "Workflow Input" as a group header

  Scenario: Fields show type icons
    Given the insertion menu is open
    Then field "input" shows a string type icon
    And field "output_text" shows a string type icon

  Scenario: Fields show type badges
    Given the insertion menu is open
    Then field "input" shows a "STRING" type badge
    And field "output_parsed" shows an "OBJECT" type badge

  # ============================================================================
  # Searching and filtering
  # ============================================================================

  Scenario: Search filters fields
    Given the insertion menu is open
    When I type "output" in the search input
    Then only fields containing "output" are shown
    And I see "expected_output" under "Test Data"
    And I see "output_text" under "Web research agent"
    And I see "output_parsed" under "Web research agent"
    And I do not see "input" fields

  Scenario: Search is case-insensitive
    Given the insertion menu is open
    When I type "OUTPUT" in the search input
    Then fields containing "output" are still shown

  Scenario: Empty search shows all fields
    Given the insertion menu is open
    And I have typed "test" in search
    When I clear the search input
    Then all fields from all sources are shown

  Scenario: No results message
    Given the insertion menu is open
    When I type "nonexistent" in the search input
    Then I see a "No matching fields" message

  # ============================================================================
  # Selecting a field
  # ============================================================================

  Scenario: Click to select a field
    Given the insertion menu is open
    And the cursor is after "Hello {{"
    When I click on field "input" from "Test Data"
    Then "{{input}}" is inserted in the textarea
    And the menu closes
    And the textarea shows "Hello {{input}}"

  Scenario: Keyboard navigation and Enter to select
    Given the insertion menu is open
    When I press ArrowDown to highlight "input"
    And I press Enter
    Then the field is inserted and menu closes

  Scenario: Escape closes menu without inserting
    Given the insertion menu is open
    When I press Escape
    Then the menu closes
    And nothing is inserted
    And the "{{" remains in the textarea

  # ============================================================================
  # Auto-create variable on selection
  # ============================================================================

  Scenario: Selecting field creates new variable
    Given the insertion menu is open
    And no variable named "input" exists
    When I select field "input" from "Test Data"
    Then a new variable "input" is created in the Variables section
    And the variable has type "str"

  Scenario: Selecting field sets mapping automatically
    Given the insertion menu is open
    And showMappings is true
    When I select field "input" from "Test Data"
    Then the new variable "input" has mapping to "Test Data.input"

  Scenario: Selecting does not duplicate existing variable
    Given a variable "input" already exists
    And the insertion menu is open
    When I select field "input" from "Test Data"
    Then no duplicate variable is created
    And the existing variable's mapping is updated

  Scenario: Type is derived from source field
    Given the insertion menu is open
    And field "count" from "Test Data" has type "number"
    When I select field "count"
    Then the created variable has type "float"

  # ============================================================================
  # "Add context" button (alternative trigger)
  # ============================================================================

  Scenario: Add context button appears on hover
    Given the textarea is not focused
    When I hover over the textarea
    Then an "Add context" button appears at the bottom-right

  Scenario: Add context button opens menu
    When I click the "Add context" button
    Then the variable insertion menu appears
    And the menu shows all available sources

  Scenario: Add context inserts at end of textarea
    Given the textarea contains "Hello"
    When I click the "Add context" button
    And I select field "input" from "Test Data"
    Then the textarea shows "Hello {{input}}"

  Scenario: Add context button not shown when typing
    Given the textarea is focused
    And I am typing
    Then the "Add context" button is hidden

  # ============================================================================
  # Creating new variable from menu
  # ============================================================================

  Scenario: Option to create new variable
    Given the insertion menu is open
    And I have typed "custom_var" in search
    And no field matches "custom_var"
    Then I see an option "Create variable 'custom_var'"

  Scenario: Create custom variable from menu
    Given the insertion menu is open
    And I type "my_custom" in search
    When I click "Create variable 'my_custom'"
    Then "{{my_custom}}" is inserted in the textarea
    And a new variable "my_custom" is created
    And the variable has type "str"
    And the variable has no mapping

  # ============================================================================
  # Edge cases
  # ============================================================================

  Scenario: Multiple {{ insertions in same text
    Given the textarea contains "{{input}} and {{"
    And the cursor is at the end
    Then the insertion menu opens for the second "{{"
    When I select "expected_output"
    Then the textarea shows "{{input}} and {{expected_output}}"

  Scenario: Menu closes when clicking outside
    Given the insertion menu is open
    When I click outside the menu and textarea
    Then the menu closes

  Scenario: Closing brace completes variable
    Given I typed "{{input" without selecting from menu
    When I type "}}"
    Then "{{input}}" is treated as a variable reference
    And if "input" variable doesn't exist, it's marked as invalid
