Feature: Expanded text dialog handles overflow for large content
  As a user viewing trace metadata or other large content
  I want the expanded dialog to scroll when content exceeds the viewport
  So that I can browse the full content without it breaking the layout

  Background:
    Given the ExpandedTextDialog is rendered

  # ============================================================================
  # Dialog body overflow handling
  # ============================================================================

  @integration
  Scenario Outline: Full content is accessible when it exceeds the dialog viewport
    Given a large <content_type> that exceeds the dialog viewport height
    When the ExpandedTextDialog opens with formatted mode <mode>
    Then all content is accessible within the dialog

    Examples:
      | content_type  | mode     |
      | JSON object   | enabled  |
      | plain text    | disabled |
      | Markdown text | enabled  |

  @integration
  Scenario: Small content does not trigger unnecessary scrolling
    Given a small JSON object that fits within the dialog viewport height
    When the ExpandedTextDialog opens with formatted mode enabled
    Then all content is visible without scrolling

  # ============================================================================
  # Content rendering remains correct with overflow fix
  # ============================================================================

  @integration
  Scenario: JSON content renders with interactive viewer and copy button
    Given a JSON object with nested keys and values
    When the ExpandedTextDialog opens with formatted mode enabled
    Then the JSON is rendered using the interactive JSON viewer
    And the copy button is visible
    And all JSON keys and values are accessible within the dialog

  @integration
  Scenario: Scrollability persists after toggling formatted mode
    Given a large JSON object displayed in the ExpandedTextDialog
    When I toggle the "Formatted" switch off
    Then all content is accessible within the dialog
