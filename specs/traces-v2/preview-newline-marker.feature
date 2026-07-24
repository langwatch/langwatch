Feature: Newline marker in the compact I/O preview
  As an operator scanning trace input/output previews in the table
  I want hard line breaks marked without polluting what I copy
  So that I can see where the source wrapped, and still paste clean text

  # The marker mimics the GitHub diff gutter: the +/- glyphs are visible
  # but never land in the clipboard when you select and copy a diff. Our
  # newline marker (↵) follows the same rule, and additionally never
  # occupies layout width so it can't wrap onto a line of its own.

  @unit
  Scenario: The newline marker is not part of the selectable text
    Given a preview whose source text contains a hard line break
    When the preview renders the two lines
    Then the rendered text content does not contain the ↵ glyph
    And selecting and copying the preview yields the clean two-line text

  @unit
  Scenario: The newline marker sits at the end of the line that was broken
    Given a preview whose source text contains a hard line break
    When the preview renders
    Then the marker is anchored to the end of the first line, not the start of the second

  @unit
  Scenario: A single-line preview renders no newline marker
    Given a preview whose source text has no line breaks
    When the preview renders
    Then no newline marker is emitted
