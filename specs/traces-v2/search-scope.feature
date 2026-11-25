Feature: A trace search stays with its project and its person

  As someone searching traces
  I want the search bar to start clean in another project or another person's session
  So that a search, an Instant Eval above all, never runs against data it was not typed for

  The search-bar filter, Instant Eval `eval:"..."` chips included, is a draft
  kept for the open session only. It is not remembered on the device, and it
  never follows the user into another project or another person's session,
  as impersonation starts one. Column, sort and grouping drafts still persist
  (specs/traces-v2/view-system.feature, "Draft state on lenses").

  @unit
  Scenario: A search does not follow the user into another project
    Given the user searched `eval:"is the answer polite?"` on the "All" lens in one project
    When the user opens the Observe page in a different project
    Then the search bar holds the "All" lens's own filter
    And no Instant Eval run is held for the old search

  @unit
  Scenario: A search does not carry into another person's session
    Given the user searched `eval:"is the answer polite?"` on the "All" lens
    When the session changes to another person, as impersonation does
    Then the search bar holds the "All" lens's own filter

  @unit
  Scenario: A search is not remembered on the device
    Given the user searched on the "All" lens and hid a column
    When the page reloads at an address that names no search
    Then the search bar holds the "All" lens's own filter
    But the hidden column stays hidden
