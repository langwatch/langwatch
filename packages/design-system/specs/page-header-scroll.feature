Feature: Sticky glass page titles
  Page titles share the content ground. Content scrolls beneath their glass;
  a reserved hairline appears after scrolling, without shifting layout.
  Reduced graphics removes blur and restores opacity. Reduced motion removes the fade.

  @integration
  Scenario: The hairline appears only after content crosses the title boundary
    Given a page title inside a nested scroll container
    When content scrolls beneath the title
    Then the hairline is visible without changing the header height
    When the content returns to the top
    Then the hairline is transparent

  @integration
  Scenario: Restored scroll positions show the title separator immediately
    Given the page opens at a saved scroll position
    Then the title hairline is visible on mount

  @integration
  Scenario: Scrolling another pane does not decorate the page title
    Given the page is at the top
    When an unrelated drawer scrolls
    Then the page title hairline remains transparent

  @integration
  Scenario: Explicit borderless headers remain borderless after scrolling
    Given a title explicitly opts out of a border
    When the content scrolls
    Then no title hairline is drawn

  @integration
  Scenario: The area pins header geometry independently of actions
    Given a shell or section area with large headers
    When headers have no actions, one action, or several actions
    Then every header row is 48 pixels high
    And every title box starts 24 pixels from the left and 10 pixels from the top
    And titles are 20 pixel semibold with a 28 pixel line box
    And buttons are 36 pixels high
    And a page cannot select compact sizing inside that area

  @integration @browser
  Scenario: A described header grows to its description and spaces it by the scale
    Given a large header with a one-line description
    Then the title sits 12 pixels below the top and the description 4 pixels below the title
    And the header is 12 pixels of padding, a 1 pixel rule and 77 pixels high in all
    And a header without a description reserves no line for one
    And a description that wraps adds 20 pixels a line and is never clipped

  @integration @browser
  Scenario: A narrow described header wraps its actions below instead of overlapping the title
    Given a described header with four actions in a 390 pixel container
    Then the actions sit below the description and the title never overlaps them
    And a long title is cut with an ellipsis rather than overflowing
    And the same header at 1280 pixels keeps its actions beside the title at 77 pixels high

  @integration
  Scenario: Full-screen tools may use compact headers
    Given a standalone tool with no sidebar siblings
    Then its compact header is 48 pixels high
    And its title is 15 pixel semibold and its buttons are 28 pixels high

  @browser @unimplemented
  Scenario: Rounded shell cards contain sticky headers during scrolling
    Given a settings page inside the shell content card
    When the page is at the top or scrolled
    Then the header stays inside the card border and rounded corner
    And its title keeps the same offset from the card top

  @browser @unimplemented
  Scenario: Section separators stay deliberately separated
    Given a section page with a 196 pixel rail
    Then the rail title and page title share their baseline and row height
    And the rail line begins 8 pixels below the header row
    And the header hairline begins 8 pixels to the right of the rail
    And content begins at the normal 24 pixel inset
