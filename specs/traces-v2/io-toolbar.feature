Feature: Trace drawer input and output toolbar
  The INPUT and OUTPUT panels of the trace drawer show one row of controls:
  a compact format selector, the actions that operate on the field
  (translate, comment, suggest edit, open in playground), and a copy
  button. They are grouped on the right of the row, which leaves the panel
  label alone on the left: a reader follows the content, not the controls.
  The row must stay usable on a narrow drawer, so actions that do not fit
  collapse into the shared three-dot overflow menu instead of being cut
  off.

  The same format selector is the one control for view modes wherever the
  drawer offers several: the conversation view (thread, bubbles, markdown),
  the span attributes table (flat, JSON) and a single attribute value
  (chat, JSON, text) use it too.

  @integration
  Scenario: One selector holds the view formats
    Given an input panel with JSON content
    When the user opens the format selector
    Then the menu lists Pretty, Text, JSON and Markdown
    And picking a format switches the panel to that view

  @integration
  Scenario: The format selector sits with the actions, not with the label
    Given an input panel in the drawer
    Then the format selector is in the right-hand group with the actions
    And the panel label keeps the left of the row to itself

  @integration
  Scenario: The active format keeps its inline layout toggles
    Given a chat-shaped input rendered in the Pretty format
    Then the thread and bubbles layout toggles sit next to the selector
    And switching to Markdown shows the rendered and source toggles instead

  @integration
  Scenario: Actions that do not fit collapse into the overflow menu
    Given a toolbar too narrow for all action buttons
    Then the actions that do not fit move into the three-dot overflow menu
    And the overflow menu lists them with their icons

  @integration
  Scenario: An action selected from the overflow menu still works
    Given the translate action collapsed into the overflow menu
    When the user picks Translate from the menu
    Then the panel starts translating, the same as the inline button

  @integration
  Scenario: Copy is always the last visible control
    Given a toolbar too narrow for all action buttons
    Then the copy button stays visible after the overflow menu
    And it is never moved into the menu

  @integration
  Scenario: Attribute values use the same format selector
    Given an attribute value the drawer can render more than one way
    When the user opens its format selector
    Then the menu lists chat, JSON and text
    And a value that holds JSON inside a string reads as JSON

  @integration
  Scenario: The conversation view uses the same format selector
    Given a conversation in the drawer
    When the user opens its format selector
    Then the menu lists thread, bubbles and markdown

  @integration
  Scenario: The span attributes table uses the same format selector
    Given a span's attributes in the drawer
    When the user opens the attributes format selector
    Then the menu lists flat and JSON
