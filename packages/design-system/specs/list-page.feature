Feature: Shared list-page composition
  As someone building a resource list
  I want one controlled page with five states
  So that loading, failure, emptiness and filtering never improvise their own look
  Rulings: dev/docs/design/guidelines.md and packages/design-system/adrs/002-overlay-and-card-shapes.md

  @integration
  Scenario: A list distinguishes loading, empty and failed reads
    Given a list page awaiting its first records
    Then a skeleton replaces the rows
    When the state is empty or error
    Then the empty block or the error banner replaces the rows
    And the error banner offers a retry

  @integration
  Scenario: Refreshing a list retains records and controlled paging
    Given a populated list refreshing its records
    Then the records stay visible with a refreshing status
    When the reader changes page
    Then the feature receives the requested page

  @integration
  Scenario: The toolbar follows the state
    Given a list page with search and filters
    Then loading shows the filters and a disabled search
    And error and empty hide the toolbar
    And no-results keeps the search enabled with a clear action
    And ready shows the toolbar, rows and paging

  @integration
  Scenario: Search is a named, testable control
    Given a list page with search
    Then the search box carries its accessible name, placeholder and test id
    When the reader types
    Then the feature receives the new value

  @integration
  Scenario: A failed refresh keeps the rows
    Given a ready list whose refresh failed
    Then an inline notice shows above the retained rows

  @integration
  Scenario: An appending list loads more instead of paging
    Given a list page with load-more
    Then the rows are followed by the count and a Load more button
    And no page controls are drawn

  @integration
  Scenario: A detail list keeps its way back as a link
    Given a list page with a back link
    Then the link keeps its href
    And a plain click routes through onNavigate while a modified click is left to the browser

  @integration
  Scenario: Bulk selection appears only over ready rows
    Given a list page with a selection bar
    Then the bar shows when the list is ready
    And it is hidden while loading, failed, empty or without results

  @integration
  Scenario: Pages written before the states keep working
    Given a list page given loading, error, empty and toolbar nodes instead of a state
    Then it renders them as it always did

  @integration
  Scenario: An empty list always points to a next step
    Given a list page in the empty state
    Then its configuration must carry a next step
    And no generic fallback line is drawn when a state's configuration is missing
