# Attribute value viewer — JSON highlighting + readable text
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/AttributeValue.tsx  (JsonBody / text FormatBody)
#   langwatch/src/features/traces-v2/components/TraceDrawer/JsonHighlight.tsx   (existing Shiki JSON renderer to reuse)
#
# Motivation (round 5): the attribute-value data viewer (used for span
# attribute values, event content, etc.) prettifies JSON but renders it as
# one flat monospace colour (`<Text as="pre">`) — no syntax highlighting,
# so it reads as a wall of grey and is hard to scan in dark mode. The
# drawer already ships a Shiki-based JSON renderer (`JsonHighlight`) used
# elsewhere; the attribute viewer should reuse it. The plain "Text" view
# should also use a high-contrast foreground so it's legible in dark mode.

Feature: Attribute value viewer readability

  Background:
    Given the user is authenticated with "traces:view" permission
    And the trace drawer is open on a span with attributes
    And the user opens an attribute value popover

  Scenario: Detected JSON attribute values are syntax highlighted
    Given the attribute value is recognised as JSON
    Then the JSON renders with syntax highlighting
    And keys, strings, numbers, and booleans are visually distinct
    # Reuses the drawer's existing Shiki JSON renderer rather than flat mono text.

  Scenario: Choosing the JSON format highlights the value
    Given the user selects the "JSON" format for the attribute value
    Then the JSON renders with syntax highlighting
    And keys, strings, numbers, and booleans are visually distinct

  Scenario: Text attribute values are legible in dark mode
    Given the attribute value is shown in the "Text" format
    And the user is in dark mode
    Then the text uses a high-contrast foreground colour
    And it is not the hard-to-read muted grey it used before

  Scenario: Event content gets the same treatment
    Given an event's content is shown in the attribute value viewer
    Then JSON content is syntax highlighted
    And text content is legible in both light and dark modes
