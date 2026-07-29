Feature: Rename code blocks in Studio
  As a Studio user building workflows,
  I want to rename code blocks with custom descriptive names
  so that complex workflows are easier to navigate and understand.

  Background:
    Given the user has a workflow open in Studio
    And the workflow contains a code block

  # ---------------------------------------------------------------------------
  # The MODEL side of renaming — what a rename does to the node, its generated
  # Python, its edges, and which names are refused — is fully covered.
  # The properties PANEL that drives it renders in no test, so every scenario
  # phrased as a panel interaction is parked rather than bound to the store
  # call underneath it.
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Display editable name in code block properties panel
    When the user selects a code block
    Then the properties panel shows an editable name field
    And the name field displays the current code block name

  @integration @unimplemented
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

  @integration
  Scenario: Renaming a wired-up block keeps its connections
    Given a code block with edges into and out of it
    When the user renames it
    Then the edges still point at the block under its new id

  @unit
  Scenario: Reject empty name
    When the user confirms an empty name
    Then the rename is rejected

  @unit
  Scenario: Reject whitespace-only name
    When the user confirms "   " as the name
    Then the rename is rejected

  @unit
  Scenario: Reject name that collides with an existing node ID
    Given the workflow also contains a code block named "parser"
    When the user renames the first code block to "Parser"
    Then the rename is rejected

  @unit
  Scenario: Reject name that produces an invalid Python identifier
    When the user renames the code block to "123test"
    Then the rename is rejected

  @unit
  Scenario: Renaming a block to the name it already has is allowed
    When the user confirms the name the block already carries
    Then the rename is accepted rather than read as a collision with itself

  @unit
  Scenario: A name with spaces becomes an underscored identifier
    When the user names a code block with spaces in it
    Then the rename is accepted
    And the identifier it produces uses underscores

  # Nothing asserts that the field snaps back to the old name after a refusal —
  # only that the refusal happens.
  @integration @unimplemented
  Scenario: A refused name leaves the field showing the previous one
    When a rename is rejected
    Then the name field reverts to the previous value

  @integration @unimplemented
  Scenario: Rename persists on workflow save
    When the user renames a code block to "Custom Name"
    And the workflow is saved
    Then reloading the workflow shows the code block named "Custom Name"

  @unit
  Scenario: Duplicate code block gets unique name
    Given a code block named "Data Processor"
    When the user duplicates the code block
    Then the duplicate gets a suffixed name to avoid collision

  @unit
  Scenario: A duplicate is named after what the block is called now
    Given a code block that has already been renamed
    When the user duplicates it
    Then the duplicate's name is based on its current name, not its original one

  # Canvas inline editing (double-click to rename on the node header) is
  # deferred to a follow-up issue to keep scope focused on the properties
  # panel interaction.
