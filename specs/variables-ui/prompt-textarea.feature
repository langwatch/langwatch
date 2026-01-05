@unit
Feature: Prompt textarea with variable chips
  As a user writing prompts
  I want variables to render as visual chips in the textarea
  So that I can easily identify and work with template variables

  Background:
    Given the prompt textarea is rendered
    And variables "input" and "context" exist

  # ============================================================================
  # Variable chip rendering
  # ============================================================================

  Scenario: Variables render as styled chips
    Given the textarea value is "Hello {{input}}, here is {{context}}"
    Then "{{input}}" renders as a blue chip
    And "{{context}}" renders as a blue chip
    And the rest of the text renders normally

  Scenario: Invalid variables render with warning style
    Given the textarea value is "Hello {{nonexistent}}"
    And no variable "nonexistent" exists
    Then "{{nonexistent}}" renders with a red/warning style chip

  Scenario: Chips are inline with text
    Given the textarea value is "Question: {{input}} Answer:"
    Then the chip appears inline between "Question: " and " Answer:"
    And text flows naturally around the chip

  # ============================================================================
  # Editing behavior
  # ============================================================================

  Scenario: Typing before a chip
    Given the textarea value is "{{input}}"
    When I position cursor at the start
    And I type "Hello "
    Then the textarea shows "Hello {{input}}"

  Scenario: Typing after a chip
    Given the textarea value is "{{input}}"
    When I position cursor at the end
    And I type " world"
    Then the textarea shows "{{input}} world"

  Scenario: Backspace deletes chip as unit
    Given the textarea value is "Hello {{input}}"
    When I position cursor after "{{input}}"
    And I press Backspace
    Then the entire "{{input}}" chip is deleted
    And the textarea shows "Hello "

  Scenario: Delete key removes chip as unit
    Given the textarea value is "{{input}} world"
    When I position cursor before "{{input}}"
    And I press Delete
    Then the entire "{{input}}" chip is deleted
    And the textarea shows " world"

  Scenario: Cannot edit inside a chip
    Given the textarea value is "{{input}}"
    When I try to position cursor inside the chip
    Then the cursor moves to before or after the chip
    And I cannot type inside the chip characters

  # ============================================================================
  # Selection behavior
  # ============================================================================

  Scenario: Click on chip selects entire chip
    Given the textarea value is "Hello {{input}} world"
    When I click on the "{{input}}" chip
    Then the entire chip is selected

  Scenario: Drag selection includes whole chips
    Given the textarea value is "Hello {{input}} world"
    When I drag select from "H" to "w" in "world"
    Then the selection includes the entire "{{input}}" chip
    And the selection is "Hello {{input}} w"

  Scenario: Copy chip includes mustache syntax
    Given the textarea value is "{{input}}"
    When I select all and copy
    Then the clipboard contains "{{input}}"

  Scenario: Cut chip removes it
    Given the textarea value is "Hello {{input}}"
    When I select the chip and cut
    Then the textarea shows "Hello "
    And the clipboard contains "{{input}}"

  Scenario: Paste variable text creates chip
    Given the textarea is empty
    When I paste "{{input}}"
    Then a chip for "{{input}}" renders

  # ============================================================================
  # Cursor navigation
  # ============================================================================

  Scenario: Arrow keys skip over chips
    Given the textarea value is "A{{input}}B"
    When I position cursor after "A"
    And I press ArrowRight
    Then the cursor moves to after "{{input}}" (before "B")

  Scenario: Arrow left skips over chips
    Given the textarea value is "A{{input}}B"
    When I position cursor before "B"
    And I press ArrowLeft
    Then the cursor moves to after "A" (before "{{input}}")

  # ============================================================================
  # Textarea sizing and overflow
  # ============================================================================

  Scenario: Textarea expands with content
    Given the textarea has multi-line content with chips
    Then the textarea height adjusts to fit content
    And chips wrap to new lines as needed

  Scenario: Long chip names display properly
    Given a variable "very_long_variable_name_here" exists
    And the textarea value is "{{very_long_variable_name_here}}"
    Then the chip displays the full name
    And the chip does not overflow the textarea

  # ============================================================================
  # Placeholder and empty state
  # ============================================================================

  Scenario: Show placeholder when empty
    Given the textarea is empty
    Then the placeholder text is visible

  Scenario: Placeholder disappears when typing
    Given the textarea is empty and shows placeholder
    When I start typing
    Then the placeholder disappears

  # ============================================================================
  # Integration with variable insertion menu
  # ============================================================================

  Scenario: Inserted variable becomes chip
    Given the textarea value is "Hello "
    When I type "{{"
    And I select "input" from the insertion menu
    Then a new chip "{{input}}" appears
    And the textarea shows "Hello {{input}}"

  Scenario: Multiple insertions create multiple chips
    When I type "{{input}} and {{context}}"
    Then two chips render in the textarea

  # ============================================================================
  # Undo/Redo
  # ============================================================================

  Scenario: Undo chip insertion
    Given the textarea value is "Hello "
    When I insert "{{input}}" via the menu
    And I press Cmd+Z
    Then the textarea shows "Hello {{"

  Scenario: Redo chip insertion
    Given I just undid a chip insertion
    When I press Cmd+Shift+Z
    Then the chip is restored

  # ============================================================================
  # Focus and blur
  # ============================================================================

  Scenario: Focus shows cursor
    When I click on the textarea
    Then the textarea is focused
    And a cursor is visible

  Scenario: Blur triggers onChange
    Given I have made changes to the textarea
    When I click outside the textarea
    Then the onChange callback is triggered with the new value
