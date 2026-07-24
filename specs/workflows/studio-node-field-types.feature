Feature: Studio node field type selector
  As a user editing a node's inputs, outputs or results in the optimization studio
  I want the field type control to look clickable and name the type
  So that I know I can change a field's type and what it currently is

  # Customer context: the studio node panels (End node Results, Entry node
  # outputs, code/agent/evaluator inputs and outputs) used a bare cyan type
  # label with a hidden native select on top. It read as decoration, so
  # users did not realise the type was changeable. The shared field editor
  # now uses the same outline FieldTypeSelect as the rest of the app: an
  # icon plus the type NAME (Text, Number, Boolean, ...) that opens a menu
  # of the available types. Read-only fields (the evaluator End node) show
  # the same icon and label as static text.

  Background:
    Given I am logged in
    And I have a workflow open in the optimization studio

  @integration
  Scenario: The field type selector reads as a clickable outline button
    Given a node with a "str" result field
    When I open the node's properties panel
    Then the field type selector shows the label "Text"
    And the field type selector reads as a clickable outline button
    And there is no bare native select behind the type label

  @integration
  Scenario: Picking a type from the menu writes it back to the node
    Given a node with a "str" result field
    When I open the field type selector
    And I pick "Number" from the menu
    Then the field's type changes to "float" on the node

  @integration
  Scenario: Read-only field types render as a static icon and label
    Given a read-only result field of type "float"
    When I open the node's properties panel
    Then the field type shows the label "Number" with its icon
    And there is no clickable type control
