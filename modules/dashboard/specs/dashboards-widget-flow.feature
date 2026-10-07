Feature: Dashboards widget flow: the editor with Langy, the widget menu and Undo
  As a project member building a board
  I want one editor that opens with Langy beside it and shows how my own agent makes the
  same edit, a widget menu that copies what my agent needs, and Undo after every change
  So that I can change a board freely and hand the work to Langy or my own agent
  # Owner decisions: langwatch/tasks#911 "Owner asks and decisions log", sections Widgets and
  # Langy drafts. Design source: the prototype's pass 7 (WidgetEditor, BlockMenu, useWidgetUndo).

  # ---------------------------------------------------------------------------
  # The editor
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Widget editor: Edit code opens the editor with Langy beside it
    Given a widget on a board and Langy is available
    When the member picks "Edit code" in the widget's menu
    Then the editor opens on that widget's name, code and queries
    And Langy opens with that widget attached and nothing drafted
    And Langy is told that widget is on screen until the editor closes
    # Decision: Langy has no widget context kind; the widget rides as a dashboard reference

  @integration
  Scenario: Widget editor: Edit with Langy drafts the edit about that widget
    Given a widget on a board and Langy is available
    When the member picks "Edit with Langy" in the widget's menu
    Then the editor opens on that widget
    And Langy has a draft, not a sent question, asking to edit that widget with the member
    And the draft is about that board and that widget, so it goes once the editor closes untouched

  @unit @integration
  Scenario: Widget editor: Langy's suggestions fit the widget's shape
    Given the editor is open and Langy is available
    Then above the tabs Langy suggests changes that fit what the widget draws:
      a line over time, bars by group, or one figure
    And a new widget gets starting points instead
    And picking a suggestion drafts it in Langy about that widget, for the member to send
    And without Langy the editor shows no suggestions
    # Decision: a catalogue widget's shape is its question's; any other widget's is read from
    # its queries. The prototype's "Why did it spike on <day>?" needs the board's data; not built.

  @integration
  Scenario: Widget editor: the tabs are Code, Queries and API / MCP
    Given the editor is open on a saved widget
    Then its tabs are Code, Queries and API / MCP
    And API / MCP shows the widget id, the REST call that edits it in this project and the
      update_dashboard_widget MCP tool call, each ready to copy
    And on a new widget API / MCP says to save the widget first
    # Decision: the app's widgets keep their Queries tab, which the prototype's single query lacks

  @unit
  Scenario: Widget editor: the API snippets name the real call and tool
    Then the REST snippet is a PATCH to the project's dashboard widget, authenticated with the
      member's API key, changing its name and code
    And the MCP snippet calls update_dashboard_widget with the board and widget ids

  @integration
  Scenario: Add a widget: Skip opens the editor on a new widget
    Given the member opened "Add a widget" on a board
    When they press "Skip"
    Then the picker closes and the editor opens on a new widget with the starter chart
    When they save it
    Then the widget is added half wide below everything on the board, recorded as made in code

  # ---------------------------------------------------------------------------
  # The widget menu
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Widget menu: the actions follow the prototype's order
    Given Langy is available
    When the member opens a widget's menu
    Then it offers Edit with Langy, Edit code, Copy widget id, Copy API snippet, Set an alert,
      Send as a report, Duplicate and Delete, in that order

  @integration
  Scenario: Widget menu: Copy widget id and Copy API snippet copy what an agent needs
    When the member picks "Copy widget id" in a widget's menu
    Then the widget's id is on the clipboard and the board says it was copied
    When they pick "Copy API snippet"
    Then the REST call that edits that widget in this project is on the clipboard

  # ---------------------------------------------------------------------------
  # Undo
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Undo: every widget change ends in a toast with Undo
    When the member adds, duplicates, edits, moves, resizes or deletes a widget
    And the change is saved
    Then a toast says what changed and offers Undo
    And a change that failed offers no Undo

  @integration
  Scenario: Undo: Undo puts the board back as it was, on the server
    Given the member deleted a widget, or saved an edit, or duplicated one
    When they press Undo on the toast
    Then the deleted widget is made again at its old place, with its code, queries and source
    And an edit is written back as it was, and a copy is removed
    And the board stays that way after reload

  @unit
  Scenario: Undo: the restore plan puts the board back as it was
    Given the board before a change and the board now
    Then widgets added since are removed and widgets deleted since are made again
    And widgets edited since are reverted, and widgets moved or resized since are put back
    And a board that did not change needs no write

  # ---------------------------------------------------------------------------
  # Where a widget came from
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Widget source: every widget made on a board records where it came from
    When the member adds a widget from "Add a widget"
    Then it is recorded as from the catalogue, with that catalogue widget's id
    When they duplicate a widget
    Then the copy keeps the original's source
    And a widget saved from the blank editor is recorded as made in code
    And a board made from a template records each widget's catalogue widget

  # ---------------------------------------------------------------------------
  # Missing data and refresh
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Missing data: Ask Langy to help drafts how to send the missing field
    Given a widget whose traces lack a field it reads
    When the member presses "Ask Langy to help" on its setup view
    Then Langy has a draft starting "Help me send <the field's name> on my traces"
    And the draft names the field, the widget and its queries, then the dashboard period
    And it is about the board, as the card's other Langy actions are
    # Decision: a draft made on the board view is about the board; one about the widget alone
    # would wait for an editor that never opens and never be dropped

  @integration
  Scenario: Auto-refresh is off until the member picks an interval
    Given a member who never picked an auto-refresh interval
    When they open a board, or legacy Analytics, which shares the choice
    Then nothing refreshes on a schedule, and "Refresh now" in the period menu re-reads it
    And the period pill shows no refresh, whatever the member picked
