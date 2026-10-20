Feature: A dialog's title has the frame's width
  The title sits at the start of the frame and runs up to the X; the description is under it,
  never in a column beside it.

  @integration @browser
  Scenario: A dialog title takes the width up to the X and its description sits under it
    Given a dialog with a four word title, a description and an X
    Then the title stays on one line and ends before the X
    And the description starts under the title at the same left edge
    And a title far longer than the frame wraps across the frame's width and ends before the X
