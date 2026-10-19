Feature: List table parts
  As someone building a list of rows
  I want closed parts with behaviour built in
  So that rows open, select, expand and sort the same way everywhere, for mouse, keyboard and screen reader
  Rulings: .claude/tmp/ds-sweep/shapes-spec-2.md sections 3 and 8 (Alex, 2026-10-11)

  @integration
  Scenario: List table parts ignore props they do not declare
    Given parts given cosmetic props past the types
    Then none of them reaches the element, while data attributes are forwarded

  @integration
  Scenario: A row opens by mouse and keeps table semantics
    Given a row with onActivate
    When the reader clicks its surface
    Then it activates once
    And the row has no tab stop, role or key handler
    And a cell marked stopRowActivation never activates it

  @integration
  Scenario: Click, Enter and Space cause exactly one action
    Given a row action inside a clickable row
    When the reader clicks it, or presses Enter or Space on it
    Then only the row action runs
    And clicks from checkboxes, action menus and portals never activate the row

  @integration
  Scenario: A row action that is a link routes in place and leaves new tabs to the browser
    Given a row action with an href
    Then it is a real link
    And a plain click routes through onNavigate
    And a modified click is left to the browser

  @integration
  Scenario: A disabled row shares one gate
    Given a disabled row
    Then it never activates and its row action and checkbox are disabled

  @integration
  Scenario: A row can prefetch and report busy
    Given a row with onPrefetch and aria-busy
    Then pointer entry and focus within call onPrefetch
    And the row reports busy

  @integration
  Scenario: Selection and sorting emit valid table structure and change state
    Given a table whose select and sort headers are drawn by an outer cell loop
    Then every cell sits directly under a row
    And Space toggles a row checkbox and select-all reflects the selection

  @integration
  Scenario: Sort headers report Shift and rank, with aria-sort on the header cell
    Given sortable columns
    When the reader clicks or presses Enter, with or without Shift
    Then onSort reports multi
    And aria-sort is on the header cell and rank is announced

  @integration
  Scenario: An expand control names, toggles and controls its detail rows
    Given an expandable row controlling two detail rows
    Then aria-expanded is on the button, never the row
    And aria-controls lists the detail rows once open
    And the button toggles once

  @integration
  Scenario: A loading table announces itself
    Given a table that is loading
    Then the table is aria-busy and a named status sits outside it
    And the skeleton rows are hidden from assistive technology

  @integration
  Scenario: A virtual table keeps continuous row indexes and hidden padding rows
    Given a virtual table with measured groups
    Then row indexes are continuous and padding rows are hidden and uncounted

  @integration
  Scenario: Column widths become pixels and the group stays in the DOM
    Given a fixed layout with a column group and small numeric widths
    Then widths are pixel strings and "fit" is one percent

  @integration
  Scenario: An empty row always carries a next step beside its callbacks
    Given empty, no-results and error rows
    Then each shows its next step beside clear or retry
    And a failure is an alert
    And a missing or empty next step is a type error

  @integration
  Scenario: Rich cells are hosted unchanged by the table shell
    Given cells of nested markdown, a tool-call tree, long JSON, chat, an image and a diff
    Then each renders exactly what it renders with no shell
    And a 5,000-character value arrives whole

  @integration
  Scenario: A measured virtual table re-measures a row whose cell expands
    Given a measured virtual table
    When a tool-call node expands
    Then the row group is measured again

  @integration
  Scenario: A measured virtual table reaches its last row and keeps row indexes
    Given a measured virtual table
    When the reader scrolls to the end
    Then the last row renders with the right row index

  @integration
  Scenario: A measured virtual table keeps selection and expansion across scrolling
    Given a measured virtual table
    Then rows select and expand around the rich cells

  @integration
  Scenario: A column may omit its width and a header may grow with its content
    Given a column with no width and a table with headerLayout content
    Then the column declares no width and the header grows with wrapped text
