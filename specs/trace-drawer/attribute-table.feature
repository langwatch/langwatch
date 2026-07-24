Feature: Attribute table label column is resizable and tooltipped

  Prompt-heavy traces (`langwatch.prompt.variables.<name>`, deep nested
  attribute namespaces) routinely produce attribute keys that overflow
  the fixed 200px label column and end up truncated to
  `langwatch.prompt.variab…`. Operators need to see the full key without
  navigating away from the row, so the label column is per-device
  resizable and every truncated key reveals its full value on hover.

  Scenario: Truncated attribute name reveals its full value on hover
    Given an attribute key longer than the label column
    When the user hovers over the truncated label
    Then a tooltip appears with the full attribute name

  Scenario: Operator drags the label column wider
    Given the attribute table is rendered with the default label column width
    When the user drags the right border of the label column to the right
    Then the label column grows live with the drag
    And the width is clamped between 120px and 480px

  Scenario: Resize handle lights up blue on hover and drag
    Given the operator hovers the right border of the label column
    Then the border turns blue
    And the cursor switches to col-resize

  Scenario: Resized width persists across drawer reopens
    Given the operator has resized the label column wider
    When the operator closes the drawer and opens any span
    Then the label column starts at the previously chosen width
    And the width survives a page reload
