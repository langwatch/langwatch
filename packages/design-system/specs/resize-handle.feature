Feature: Resize handle
  As someone reading long names in a narrow column
  I want to drag the column's edge wider
  So that the names fit without opening each entry

  The handle sits on the column's right edge. It reports widths between the
  column's minimum and maximum; the column keeps the width.

  @integration
  Scenario: Dragging the edge reports a width between the minimum and the maximum
    Given a column with a resize handle
    When the reader drags the edge to the right
    Then the column is told the new width
    And a drag past the maximum stops at the maximum

  @integration
  Scenario: The handle works from the keyboard
    Given a focused resize handle
    Then it reads as a vertical separator with its current, minimum and maximum width
    When the reader presses the arrow keys, Home and End
    Then the width moves by one step, or to the minimum or the maximum

  @integration
  Scenario: Double-clicking the edge puts the column back to its default width
    Given a column dragged wider
    When the reader double-clicks the edge
    Then the column is told to reset
