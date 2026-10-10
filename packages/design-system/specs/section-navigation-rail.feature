# Implementation:
#   packages/design-system/src/components/layout/section-navigation-frame.tsx
#   packages/design-system/tests/section-navigation-frame.integration.test.tsx

Feature: One section rail for every section that lists its own pages
  As someone moving between the pages of a section
  I want every section's rail to read and behave the same way
  So that the headings, entries, current chip and glass match wherever I am

  Background: the rail.
    A section rail lists the section's entries under its title, in labelled runs.
    A section whose entries carry their own controls, counts, a fold toggle or a
    period picker uses the same rail rather than a column of its own.

  @integration
  Scenario: An entry's own controls sit beside its link, not inside it
    Given a rail entry that carries a row menu
    When the reader reads the entry
    Then the menu is a sibling of the entry's link
    And the link still routes the entry in place

  @integration
  Scenario: An entry carries a trailing count
    Given a rail entry with a count of pending work
    When the reader reads the entry
    Then the count sits at the end of the entry

  @integration
  Scenario: A folded rail keeps its entries reachable by name
    Given a rail folded to its icons
    When the reader reads it
    Then each entry is still a link named after its label
    And the title, the run labels, the extras and the row controls step aside

  @integration
  Scenario: The rail pins its footer under the entries
    Given a rail with a footer holding a control
    When the reader reads the rail
    Then the footer's control sits inside the rail after every entry

  @integration
  Scenario: The add row lines up with the entries and wears their shape
    Given a run of entries that may gain one more
    When the reader reads the run
    Then an add row ends it, a button with the entries' padding, size and corner
    And using it asks the page to create one
    And a folded rail leaves it out
