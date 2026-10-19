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

  @unit @integration
  Scenario: Widget editor: Edit with Langy sends Langy its starting prompt about that widget
    Given a widget on a board and Langy is available
    When the member picks "Edit with Langy" in the widget's menu
    Then the editor opens on that widget
    And Langy is sent, not drafted, a starting prompt to edit that widget with the member
    And the prompt asks Langy to ask what the member wants the widget to show
    And that widget, on that board, is attached as the context
    # Owner list, 2026-10-08: building with Langy sends Langy a starting prompt automatically

  @unit @integration
  Scenario: Widget editor: building a new widget with Langy sends Langy a starting prompt
    Given Langy is available
    When the member presses "I'll build it myself" in "Add a widget"
    Then Langy is sent a starting prompt at once, with nothing for the member to send
    And it names the new widget being made, the board and the widgets already on it
    And it asks Langy to ask the member what they want to see, then propose and save on their word

  @integration
  Scenario: Widget editor: the editor and Langy sit side by side
    Given Langy is available and docked on the right
    When the editor opens on a widget
    Then the editor opens from the left and stops short of Langy's panel
    And Langy never covers the editor, and the editor never covers Langy
    # Owner list, 2026-10-08. The dock's width comes from the Langy contract (LANGY_DOCK_WIDTH_PX)

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
    And on a new widget API / MCP shows how the member's agent creates it instead
    # Decision: the app's widgets keep their Queries tab, which the prototype's single query lacks

  @unit
  Scenario: Widget editor: the API snippets name the real call and tool
    Then the REST snippet is a PATCH to the project's dashboard widget, authenticated with the
      member's API key, changing its name and code
    And the MCP snippet calls update_dashboard_widget with the board and widget ids

  @unit @integration
  Scenario: Widget editor: API / MCP on a new widget shows how my agent creates it
    Given the editor is open on a widget not saved yet
    When the member opens API / MCP
    Then it says in two short lines that their own agent can build the widget from scratch
    And it offers a copyable example prompt that names the add_dashboard_widget MCP tool, this
      board's id and run_query to check each query first
    And a "Read the docs" link opens the MCP docs
    And it never says the widget must be saved first, since agents can create widgets
    # Decision: the docs page on creating widgets from an agent is not written yet (follow-up);
    # the link opens the MCP setup page until it is. The CLI's create cannot place a widget on
    # a board, so the prompt names the MCP tool.

  @integration
  Scenario: Add a widget: I'll build it myself opens the editor on a new widget
    Given the member opened "Add a widget" on a board
    When they press "I'll build it myself"
    Then the picker closes and the editor opens on a new widget with the starter chart
    When they save it
    Then the widget is added half wide below everything on the board, recorded as made in code

  @integration
  Scenario: Add a widget: a picked widget shows on the board at once
    Given "Add a widget" is open on a board
    When the member picks a widget
    Then the picker closes at once and the widget's card is on the board, its data loading in it
    And once the server has stored it the toast offers Undo and its prompt is drafted in Langy
    And when the server refuses it the card goes again, the board says so and nothing is drafted
    # Owner list, 2026-10-08: no visible wait. Decision: picking still adds the widget (the
    # 2026-09-29 decision); the editor is not opened on a pick

  # ---------------------------------------------------------------------------
  # The widget menu
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Widget menu: the actions follow the prototype's order
    Given Langy is available
    When the member opens a widget's menu
    Then it offers Edit with Langy, Edit code, Copy widget id, Copy API snippet, Export CSV,
      Set an alert, Send as a report, Duplicate and Delete, in that order

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

  @integration
  Scenario: Delete: a widget leaves the board at once, with Undo
    When the member deletes a widget
    Then it leaves the board at once and the toast offers Undo before the server answers
    When they press Undo
    Then the board waits for the delete to land, then makes the widget again at its old place

  @integration
  Scenario: Delete: a refused delete puts the widget back and says so
    Given the server refuses to delete a widget
    When the member deletes it
    Then the widget comes back where it was, the Undo is taken away and the board says why

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
