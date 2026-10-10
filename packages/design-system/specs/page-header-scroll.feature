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
