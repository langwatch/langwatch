Feature: Rename code blocks in Studio
  As a Studio user building workflows,
  I want to rename code blocks with custom descriptive names
  so that complex workflows are easier to navigate and understand.

  Background:
    Given the user has a workflow open in Studio
    And the workflow contains a code block

  @integration
  Scenario: Display editable name in code block properties panel
    When the user selects a code block
    Then the properties panel shows an editable name field
    And the name field displays the current code block name

  @integration
  Scenario: Rename a code block via the properties panel
    When the user selects a code block
    And the user clicks the name field in the properties panel
    And the user types a new name "Data Processor"
    And the user presses Enter or clicks away
    Then the code block name updates to "Data Processor"
    And the canvas node header reflects the new name

  @integration
  Scenario: Rename updates the node ID and Python class name
    Given a code block with name "code1"
    When the user renames it to "Data Processor"
    Then the node ID updates to "data_processor"
    And the Python class name in the code updates to "DataProcessor"

  @unit
  Scenario: Reject empty name
    When the user clears the name field and confirms
    Then the name reverts to the previous value

  @unit
  Scenario: Reject whitespace-only name
    When the user enters "   " as the name and confirms
    Then the name reverts to the previous value

  @unit
  Scenario: Reject name that collides with an existing node ID
    Given the workflow also contains a code block named "parser"
    When the user renames the first code block to "Parser"
    Then the rename is rejected
    And the name reverts to the previous value

  @unit
  Scenario: Reject name that produces an invalid Python identifier
    When the user renames the code block to "123test"
    Then the rename is rejected
    And the name reverts to the previous value

  @integration
  Scenario: Rename persists on workflow save
    When the user renames a code block to "Custom Name"
    And the workflow is saved
    Then reloading the workflow shows the code block named "Custom Name"

  @unit
  Scenario: Duplicate code block gets unique name
    Given a code block named "Data Processor"
    When the user duplicates the code block
    Then the duplicate gets a suffixed name to avoid collision

  Note: Canvas inline editing (double-click to rename on the node header)
  is deferred to a follow-up issue to keep scope focused on the properties
  panel interaction.
