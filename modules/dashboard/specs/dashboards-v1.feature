Feature: Dashboards v1
  As a project member
  I want a Dashboards area that opens on my own board, lets me start a board
  from the Agent Flight Deck template and edit every widget on it, and ask
  Langy the questions I have
  So that I can see traffic, quality, latency and cost in one place, learn
  what else I should connect, and never touch legacy analytics or a mocked
  query to do it

  # ---------------------------------------------------------------------------
  # Navigation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: AC1 Flag off hides the area
    Given the release_dashboards flag is off for the project
    When a member opens /[project]/dashboards
    Then they get the not-found page
    And the product switcher does not offer Dashboards

  @integration
  Scenario: AC3 Sidebar matches the reference
    Given the release_dashboards flag is on for the project
    When the member looks at the Dashboards product sidebar
    Then they see "Your dashboards" with My dashboard first, then Starred when they have stars,
      then From LangWatch, each board with a menu
    And the sidebar shows nothing else besides Quick Search

  # ---------------------------------------------------------------------------
  # Agent Flight Deck
  # ---------------------------------------------------------------------------

  @unit @unimplemented
  Scenario: AC5 Status tiles compare with the previous period
    Given a request volume, success rate, p95 latency and total cost value for the selected period
    And a request volume, success rate, p95 latency and total cost value for the period immediately before it
    When the Status widget's tile values are computed
    Then each tile carries its current value and its change versus the previous period

  @integration
  Scenario: AC6 Unconnected source shows a call to action
    Given a project that has never run a scenario
    And a board made from the Agent Flight Deck template
    When the member views its Scenario results widget
    Then the widget shows the "Run a scenario" call to action from the reference
    And its button opens the scenarios page

  @integration
  Scenario: AC7 Connected state comes from real data
    Given a project that has ingested at least one row for a source
    And a board made from the Agent Flight Deck template
    When the member views that source's widget
    Then it shows data queried from that ingested row
    And no URL flag or setting decided that the source is connected

  @integration
  Scenario: AC8 Starting from the template makes a new board of editable widgets
    Given a member in the templates library
    When they create a board from a ready template
    Then a new board named after the template is created, visible only to them
    And when that name is taken it is numbered: the name, then the name with 2, then 3
    And it carries the template's description
    And every template widget is stored on it as an ordinary widget, at its template place
    And the new board opens
    And when a write fails the error is shown, the half-made board is removed and the member stays where they were

  @integration @unimplemented
  Scenario: AC9 Empty period shows an empty state
    Given a connected source with no rows in the selected period
    And a board made from the Agent Flight Deck template
    When the member views its widget for that source
    Then the widget shows an empty state
    And it is not an error state
    And it is not the call-to-action state

  # ---------------------------------------------------------------------------
  # User dashboards
  # ---------------------------------------------------------------------------

  @e2e
  Scenario: AC10 Blank board matches the reference
    Given a member creates a new dashboard
    Then every member of the project sees it, and it is starred by nobody
    When it opens
    Then they see "Add a description"
    And they see the one empty board view: the ask bar, suggested questions and the templates

  @e2e
  Scenario: AC11 Ask Langy by question
    Given a member on a board
    And Langy is enabled for the project and the member may start a conversation
    When they open the picker and choose a question
    Then the picker closes
    And Langy opens with that question's own prompt, the dashboard period and grain, ready to send
    And the open board is passed as context, by its name and id
    And the question's widget is added to the board
    # (changed by langwatch/tasks#911: picking a question now adds its widget and drafts Langy, rather than sending and writing nothing; see dashboards-v2.feature AC12)

  @integration
  Scenario: AC12 Only working questions are offered
    Given the picker is open
    When the member browses every section
    Then every listed question carries its own prompt naming the LangWatchQL views and the dashboard period
    And when Langy is not available to the member the picker still lists every question, each adding its widget only
    # (changed by langwatch/tasks#911: the picker lists every question with or without Langy; see dashboards-v2.feature AC12b)

  @integration
  Scenario: AC13 Period and grain update every block
    Given a board with widgets
    When the member changes the period
    Then every widget on the board reads over the new period as its reserved parameters

  @integration
  Scenario: AC13 Grain choices update every block
    Given a board with widgets
    When the member changes the grain to auto, 1h, 1d or 1w
    Then every widget on the board reads at the chosen grain as its reserved parameter

  @integration
  Scenario: AC14 Rename and describe
    Given a member on a board other than their My dashboard
    When they rename it from its sidebar menu or edit the description inline
    Then the change is saved
    And it is shown on the board and in the sidebar

  @integration
  Scenario: AC15 Widget menu actions persist after reload
    Given a widget on a board, including one made from the template
    When the member opens its menu
    Then it offers Edit code, Copy widget id, Copy API snippet, Duplicate and Delete
    And Edit code opens the widget editor on that widget's own code and queries
    And a Duplicate, a Delete, a move or a resize on the grid is still there after reload
    # (changed by langwatch/tasks#911: the menu follows the prototype; see dashboards-widget-flow.feature)

  @integration
  Scenario: AC16 Ask Langy from the board
    Given Langy is enabled for the project
    When the member clicks the "What do you want to know?" bar on a stored board
    Then the picker opens with the cursor in its search
    And a pinned "Ask Langy" footer is always visible below the list
    When they press "Ask Langy" on the footer
    Then Langy opens with that question and the current board as context

  @integration
  Scenario: AC18 Every Project board is visible to every member of the project
    Given a project with boards created by different members, at the scope Project
    When any member with analytics:view lists dashboards
    Then every board is listed
    And each board opens for them
    # A board's scope decides who sees it: dashboards-v2.feature AC170 to AC186

  @integration
  Scenario: AC18 Blocks on a Project board are reachable to every member
    Given a board at the scope Project holding blocks
    When any member with analytics:view lists, adds, moves or deletes blocks on it
    Then its blocks are listed and writable, subject only to the analytics permissions
    And a project credential reaches the blocks on every board

  @unit
  Scenario: AC18 Saved charts on a Project board are reachable to every member
    Given a saved chart placed on a board at the scope Project
    When any member with analytics:view lists, opens, runs, edits or deletes saved charts
    Then that chart is reachable, subject only to the analytics permissions
    And a project credential reaches the charts on every such board and on no board
    # A chart placed on an Only me board is its author's alone: dashboards-v2.feature AC171

  # ---------------------------------------------------------------------------
  # Guard rails
  # ---------------------------------------------------------------------------

  @e2e @unimplemented
  Scenario: AC19 Every dashboard data request goes to LWQL and none to legacy analytics
    Given any dashboard page is open
    When its data loads
    Then every data request goes to the LWQL endpoint
    And no request goes to a legacy analytics endpoint

  @unit @unimplemented
  Scenario: AC20 Legacy analytics files are untouched
    Given the change is merged
    When the diff is limited to the legacy analytics paths
    Then it is empty

  @integration @unimplemented
  Scenario: AC20 Legacy analytics pages behave exactly as before
    Given the change is merged
    When a member opens the legacy analytics pages
    Then they behave exactly as they did before the change

  @integration
  Scenario: AC21 A member without analytics:view is refused
    Given a member without the analytics:view permission
    When they open /[project]/dashboards
    Then access is refused

  @integration
  Scenario: AC21 A refused member sees the same not-found page
    Given a member without the analytics:view permission
    When any dashboards procedure runs for them
    Then the server answers with a permission error
    And the page shows the same not-found page as when the flag is off

  @integration @unimplemented
  Scenario: AC22 An unqueryable source ships as a call to action
    Given the LWQL catalog check for a widget's source was run at build time
    And that source is not queryable
    When the member views the widget
    Then it shows its call-to-action state for every project
    And it sends no query

  @integration @unimplemented
  Scenario: AC22 A queryable source follows the normal widget rules
    Given the LWQL catalog check for a widget's source was run at build time
    And that source is queryable
    When the member views the widget
    Then it follows the connected, unconnected and empty-period rules like any other widget

  @integration @unimplemented
  Scenario: AC23 A failing query does not take the board down
    Given one widget on a board whose LWQL query fails
    When the member views the board
    Then that widget shows an error state with a retry
    And it is not the empty state and not the call-to-action state
    And every other widget on the board still renders its own data

  @integration
  Scenario: AC24 Boards created before this change keep working
    Given a dashboard that existed before the description and creator fields were added
    When the migration has run
    And a project member lists dashboards
    Then the board is listed
    And it opens for that member
    And its blocks render as before
    And its blocks render at the grain they had before day and week were added

  @integration
  Scenario: AC25 Scenario results shows its own call to action before any row exists
    Given a project that has never recorded a row for Scenario results
    And a board made from the Agent Flight Deck template
    When the member views its Scenario results widget
    Then the widget shows Scenario results' own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Scenario results the widget shows data

  @integration
  Scenario: AC25 Quality signal shows its own call to action before any row exists
    Given a project that has never recorded a row for Quality signal
    And a board made from the Agent Flight Deck template
    When the member views its Quality signal widget
    Then the widget shows Quality signal's own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Quality signal the widget shows data

  @integration
  Scenario: AC25 User feedback shows its own call to action before any row exists
    Given a project that has never recorded a row for User feedback
    And a board made from the Agent Flight Deck template
    When the member views its User feedback widget
    Then the widget shows User feedback's own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for User feedback the widget shows data

  @integration
  Scenario: AC25 Gateway routing shows its own call to action before any row exists
    Given a project that has never recorded a row for Gateway routing
    And a board made from the Agent Flight Deck template
    When the member views its Gateway routing widget
    Then the widget shows Gateway routing's own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Gateway routing the widget shows data

  @integration
  Scenario: AC25 Your coding agents shows its own call to action before any row exists
    Given a project that has never recorded a row for Your coding agents
    And a board made from the Agent Flight Deck template
    When the member views its Your coding agents widget
    Then the widget shows Your coding agents' own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Your coding agents the widget shows data

  @integration
  Scenario: AC26 Any member with the edit permission can edit any board they can see
    Given a board created by another member, at the scope Project
    And a member with analytics:update
    When that member renames, edits or deletes the board
    Then the server accepts each write

  @unit
  Scenario: AC26 Deleting a board removes it from every member's stars
    Given a board starred by several members
    When a member with analytics:delete deletes it
    Then the board is gone from every member's starred list

  # --- AC Coverage Map ---
  # AC 1: "Flag off hides the area" → Scenario: AC1 Flag off hides the area
  # AC 2: "Landing" (changed again by langwatch/tasks#911: /dashboards lands on My dashboard) -> dashboards-v2.feature Scenario: AC160 The dashboards area lands on My dashboard
  # AC 3: "Sidebar matches the reference" (changed by langwatch/tasks#911: Your dashboards, Starred, From LangWatch; no Browse templates item) -> Scenario: AC3 Sidebar matches the reference
  # AC 5: "Status tiles compare with the previous period" → Scenario: AC5 Status tiles compare with the previous period
  # AC 6: "Unconnected source shows a call to action" → Scenario: AC6 Unconnected source shows a call to action
  # AC 7: "Connected state comes from real data" → Scenario: AC7 Connected state comes from real data
  # AC 8: "The Agent Flight Deck is a template" (changed: was "The Flight Deck cannot be edited"; the read-only board and its server refusal are gone; changed again: boards are made from the templates library, not the blank board) → Scenario: AC8 Starting from the template makes a new board of editable widgets
  # AC 9: "Empty period" → Scenario: AC9 Empty period shows an empty state
  # AC 10: "Blank board matches the reference" (changed by langwatch/tasks#911: every empty board shows one view) → Scenario: AC10 Blank board matches the reference
  # AC 11: "Add a block by question" (changed by langwatch/tasks#911: picking a question adds its widget and drafts Langy to send, instead of sending and writing nothing) → Scenario: AC11 Ask Langy by question
  # AC 12: "Only working questions are offered" (changed by langwatch/tasks#911: the picker lists every question with or without Langy) → Scenario: AC12 Only working questions are offered
  # AC 13: "Period and grain" (changed: widgets, through their reserved parameters) → Scenario: AC13 Period and grain update every block; Scenario: AC13 Grain choices update every block
  # AC 14: "Rename and describe" → Scenario: AC14 Rename and describe
  # AC 15: "Widget menu" (changed: Edit code, Copy widget id, Copy API snippet, Duplicate, Delete; no move to another board) → Scenario: AC15 Widget menu actions persist after reload
  # AC 16: "Ask Langy from the board" → Scenario: AC16 Ask Langy from the board
  # AC 17: "Langy insights on a block" (withdrawn: a widget's result lives in its sandboxed frame; no scenario until it can be read)
  # AC 18: "Every Project board is visible to every project member" (changed by langwatch/tasks#911; scope added on 2026-10-09, dashboards-v2.feature AC170-186) -> Scenario: AC18 Every Project board is visible to every member of the project; Scenario: AC18 Blocks on a Project board are reachable to every member; Scenario: AC18 Saved charts on a Project board are reachable to every member
  # AC 19: "LWQL only" → Scenario: AC19 Every dashboard data request goes to LWQL and none to legacy analytics
  # AC 20: "Legacy analytics untouched" → Scenario: AC20 Legacy analytics files are untouched; Scenario: AC20 Legacy analytics pages behave exactly as before
  # AC 21: "Permissions" (sharpened) → Scenario: AC21 A member without analytics:view is refused; Scenario: AC21 A refused member sees the same not-found page
  # AC 22: "Gateway routing and coding agents ship in the state their data supports" → Scenario: AC22 An unqueryable source ships as a call to action; Scenario: AC22 A queryable source follows the normal widget rules
  # AC 23: "A failing query does not take the board down" → Scenario: AC23 A failing query does not take the board down
  # AC 24: "Boards created before this change keep working" (sharpened) → Scenario: AC24 Boards created before this change keep working
  # AC 25: "Every optional source has its own call to action" → Scenario: AC25 Scenario results shows its own call to action before any row exists; Scenario: AC25 Quality signal shows its own call to action before any row exists; Scenario: AC25 User feedback shows its own call to action before any row exists; Scenario: AC25 Gateway routing shows its own call to action before any row exists; Scenario: AC25 Your coding agents shows its own call to action before any row exists
  # AC 26: "Any member may edit any board they can see, subject to the analytics permissions" (changed by langwatch/tasks#911; scope added on 2026-10-09) -> Scenario: AC26 Any member with the edit permission can edit any board they can see; Scenario: AC26 Deleting a board removes it from every members stars
