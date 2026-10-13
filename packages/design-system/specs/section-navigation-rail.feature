# Implementation:
#   packages/design-system/src/components/layout/section-navigation-frame.tsx
#   packages/design-system/tests/section-navigation-frame.integration.test.tsx

Feature: One section rail for a workspace with many real sub-pages
  As someone moving between the pages of a large workspace
  I want its rail to read like the product sidebar beside it
  So that one selection style and one title hold wherever I am

  Background: the rail.
    The rail is kept only for a workspace with five or more real sub-pages; a short
    set of routes uses header tabs (PageLayout.Tabs) and a list nests in the sidebar.
    The rail names its section in a 13px eyebrow, never a second 20px title; a page whose
    header above the rail already names the section leaves the eyebrow out.
    Rows are 28px with 13px text, led by their icon when the page asks for icons; group
    labels are 10px semibold uppercase. It sits on the page's own ground, with no fill of its own
    and no rule against the content.
    Selection is the sidebar's pill: the active fill, foreground text, weight 500.
    There is no edge marker.

  @integration
  Scenario: The active entry wears the sidebar's pill, with no edge marker
    Given a rail with a current entry
    When the reader reads the rail
    Then the current entry is marked as the current page
    And no separate selection marker is painted

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
    And the section title keeps its row
    And the run labels, the extras and the row controls step aside

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
