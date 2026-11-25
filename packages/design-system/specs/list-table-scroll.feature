Feature: List table scrolling
  As someone listing wide rows
  I want the table to own how it scrolls
  So that wide tables are reachable by keyboard and virtual scrollers keep their sticky header
  Rulings: packages/design-system/adrs/002-overlay-and-card-shapes.md

  @integration
  Scenario: A wide table scrolls sideways in a named, focusable region
    Given a list table with scroll x and a scroll label
    Then the table sits in a focusable region with that name

  @integration
  Scenario: A table inside a virtual scroller never clips
    Given a list table with scroll external and a sticky header
    Then the table card does not clip its content

  @integration
  Scenario: Column geometry survives the closed props
    Given a list table with a fixed layout, a minimum width and column widths
    Then the table keeps the layout, minimum width and widths

  @integration
  Scenario: Scroll x requires a label
    Given the list table prop types
    Then scroll x without a scroll label is a type error
