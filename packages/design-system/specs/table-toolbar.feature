Feature: Table toolbar and selection bar
  As someone narrowing and acting on a table
  I want one toolbar and one selection bar
  So that search, filters, columns and bulk actions look and behave the same in a page, a card and a drawer
  Rulings: .claude/tmp/ds-sweep/shapes-spec-2.md section 3.4 (Alex, 2026-10-11)

  @integration
  Scenario: The toolbar is one row of search, lookup, filters, summary, columns and actions
    Given a toolbar with every control
    Then it draws a search and a distinct lookup, the summary with Clear filters, then columns and actions
    And loading disables the search inputs
    And an empty toolbar renders nothing

  @integration
  Scenario: An inline selection bar is the first band of the toolbar
    Given a toolbar with a selection
    Then the bar is inline and precedes the toolbar row

  @integration
  Scenario: The column picker offers labelled checkbox items and locks a column
    Given a column picker with a locked column
    Then each column is a labelled checkbox item and the locked one is checked and disabled
    And a change and a reset are reported

  @integration
  Scenario: The selection bar floats by default and sits in flow when inline
    Given a selection bar
    Then it floats bottom-centre with a safe-area offset and a viewport max width
    And inline it sits in normal flow

  @integration
  Scenario: Clearing the selection returns focus to the table's select-all checkbox
    Given a selection bar for a table
    When the reader clears the selection
    Then focus goes to that table's select-all checkbox
