Feature: Dashboards v1
  As a project member
  I want a Dashboards area that opens on a ready-made Agent Flight Deck and
  lets me build my own boards from blocks and ask Langy the questions I have
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

  @e2e
  Scenario: AC2 Landing on the Flight Deck
    Given the release_dashboards flag is on for the project
    And the member has no default board of their own
    When they open /[project]/dashboards
    Then they land on the Agent Flight Deck
    And it is marked "Default" in the header
    And it is marked "Default" in the sidebar

  @integration
  Scenario: AC3 Sidebar matches the reference
    Given the release_dashboards flag is on for the project
    When the member looks at the Dashboards product sidebar
    Then they see "Saved dashboards" with a create button
    And the Agent Flight Deck is listed first
    And each of their own boards is listed with a menu
    And the sidebar shows nothing else besides Quick Search

  # ---------------------------------------------------------------------------
  # Agent Flight Deck
  # ---------------------------------------------------------------------------

  @e2e
  Scenario: AC4 The ten panels in prototype order
    Given a project with every source connected
    When the member opens the Flight Deck
    Then the panels appear in this order with their reference titles and subtitles: Status, Throughput latency and errors, Cost efficiency, Failure intelligence, Scenario results, Quality signal, User feedback, Gateway routing, Your coding agents, Most impactful traces
    And Status, Throughput latency and errors, Your coding agents and Most impactful traces span the full width
    And the other six panels sit two per row

  @unit
  Scenario: AC5 Status tiles compare with the previous period
    Given a request volume, success rate, p95 latency and total cost value for the selected period
    And a request volume, success rate, p95 latency and total cost value for the period immediately before it
    When the Status tile values are computed
    Then each tile carries its current value and its change versus the previous period

  @integration
  Scenario: AC6 Unconnected source shows a call to action
    Given a project that has never run a scenario
    When the member views Scenario results
    Then the panel shows the "Run a scenario" call to action from the reference
    And its button opens the scenarios page

  @integration
  Scenario: AC7 Connected state comes from real data
    Given a project that has ingested at least one row for a source
    When the member opens the Flight Deck
    Then that source's panel shows data queried from that ingested row
    And no URL flag or setting decided that the source is connected

  @integration
  Scenario: AC8 No edit controls appear on the Flight Deck
    Given any member, including an admin
    When they view the Flight Deck
    Then there is no rename control
    And there is no block menu with move or delete

  @integration
  Scenario: AC8 The server rejects a write against the Flight Deck
    Given the Flight Deck is defined in code and has no database rows
    When any member calls a dashboard write procedure against the Flight Deck
    Then the server refuses the write

  @integration
  Scenario: AC9 Empty period shows an empty state
    Given a connected source with no rows in the selected period
    When the member views its panel
    Then the panel shows an empty state
    And it is not an error state
    And it is not the call-to-action state

  # ---------------------------------------------------------------------------
  # User dashboards
  # ---------------------------------------------------------------------------

  @e2e
  Scenario: AC10 Blank board matches the reference
    Given a member creates a new dashboard
    Then it is visible only to them, under Mine in the sidebar
    When it opens
    Then they see "Add a description"
    And they see the "Add a block" area with "Start from the question you need answered."
    And they see "Start from a template" listing the Agent Flight Deck

  @e2e
  Scenario: AC11 Ask Langy by question
    Given a member on their own board or the Agent Flight Deck
    And Langy is enabled for the project and the member may start a conversation
    When they open the picker and choose a question
    Then the picker closes
    And Langy opens with that question's own prompt, the dashboard period and grain
    And the current board is passed as context, marked read-only on the Flight Deck
    And nothing is written to any board

  @integration
  Scenario: AC12 Only working questions are offered
    Given the picker is open
    When the member browses every section
    Then every listed question carries its own prompt naming the LangWatchQL views and the dashboard period
    And when Langy is not available to the member the picker shows no questions and nothing to choose

  @integration
  Scenario: AC13 Period and grain update every block
    Given a board with time-series blocks
    When the member changes the period
    Then every block on the board updates to match

  @integration
  Scenario: AC13 Grain choices update every block
    Given a board with time-series blocks
    When the member changes the grain to auto, 1h, 1d or 1w
    Then every block on the board updates to match the chosen grain

  @integration
  Scenario: AC14 Rename and describe
    Given a member on their own board
    When they edit the name or description inline
    Then the change is saved
    And it is shown in the sidebar

  @integration
  Scenario: AC15 Block menu actions persist after reload
    Given a block on a user board
    When the member uses Duplicate, Move to another dashboard, or Delete
    Then the board reflects the action after reload

  @integration
  Scenario: AC16 Ask Langy from the board
    Given Langy is enabled for the project
    When the member presses "What would you like to know?" on any board, the Flight Deck included
    Then the question picker opens, since the bar is a button and never a text field
    And a pinned "Ask Langy" footer is always visible below the list
    When they type their own question and press "Ask Langy" on the footer
    Then Langy opens with that question
    And the current board is passed as context

  @integration
  Scenario: AC17 Langy insights on a block quote the block's own result
    Given a block was just added
    And its query returned a result containing a number
    When the member accepts "Generate insights"
    Then Langy returns insight text
    And the insight text quotes at least one number present in that block's own query result

  @integration
  Scenario: AC18 Visibility hides a board from members outside its audience
    Given a member sets a board to only me, team or organisation
    When another member outside that audience lists dashboards
    Then the board is not listed
    And its URL is refused

  @integration
  Scenario: AC18 Blocks on a board follow the board's visibility
    Given a member sets a board holding blocks to only me or team
    When another member outside that audience lists, adds, moves or deletes blocks on it
    Then its blocks are not listed
    And every read or write of those blocks is refused as not found
    And a project credential reaches only the blocks on organisation-wide boards

  @unit
  Scenario: AC18 Saved charts on a board follow the board's visibility
    Given a member places a saved chart on a board set to only me or team
    When another member outside that audience lists, opens, runs, edits or deletes saved charts
    Then that chart is not listed
    And every read, run or write of it is refused as not found
    And a saved chart on no board stays reachable as before
    And a project credential reaches only the charts on organisation-wide boards or on no board

  # ---------------------------------------------------------------------------
  # Guard rails
  # ---------------------------------------------------------------------------

  @e2e
  Scenario: AC19 Every dashboard data request goes to LWQL and none to legacy analytics
    Given any dashboard page is open
    When its data loads
    Then every data request goes to the LWQL endpoint
    And no request goes to a legacy analytics endpoint

  @unit
  Scenario: AC20 Legacy analytics files are untouched
    Given the change is merged
    When the diff is limited to the legacy analytics paths
    Then it is empty

  @integration
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

  @integration
  Scenario: AC22 An unqueryable source ships as a call to action
    Given the LWQL catalog check for a panel's source was run at build time
    And that source is not queryable
    When the member views the panel
    Then it shows its call-to-action state for every project
    And it sends no query

  @integration
  Scenario: AC22 A queryable source follows the normal panel rules
    Given the LWQL catalog check for a panel's source was run at build time
    And that source is queryable
    When the member views the panel
    Then it follows the connected, unconnected and empty-period rules like any other panel

  @integration
  Scenario: AC23 A failing query does not take the board down
    Given one panel or block whose LWQL query fails
    When the member views the board
    Then that panel shows an error state with a retry
    And it is not the empty state and not the call-to-action state
    And every other panel on the board still renders its own data

  @integration
  Scenario: AC24 Boards created before this change keep working
    Given a dashboard that existed before the visibility fields were added
    When the migration has run
    And a project member who could open it before lists dashboards
    Then the board is listed
    And it opens for that member
    And its visibility is organisation, the value that keeps the access it had before
    And its blocks render as before
    And its blocks render at the grain they had before day and week were added

  @integration
  Scenario: AC25 Scenario results shows its own call to action before any row exists
    Given a project that has never recorded a row for Scenario results
    When the member views the Scenario results panel
    Then the panel shows Scenario results' own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Scenario results the panel shows data

  @integration
  Scenario: AC25 Quality signal shows its own call to action before any row exists
    Given a project that has never recorded a row for Quality signal
    When the member views the Quality signal panel
    Then the panel shows Quality signal's own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Quality signal the panel shows data

  @integration
  Scenario: AC25 User feedback shows its own call to action before any row exists
    Given a project that has never recorded a row for User feedback
    When the member views the User feedback panel
    Then the panel shows User feedback's own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for User feedback the panel shows data

  @integration
  Scenario: AC25 Gateway routing shows its own call to action before any row exists
    Given a project that has never recorded a row for Gateway routing
    When the member views the Gateway routing panel
    Then the panel shows Gateway routing's own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Gateway routing the panel shows data

  @integration
  Scenario: AC25 Your coding agents shows its own call to action before any row exists
    Given a project that has never recorded a row for Your coding agents
    When the member views the Your coding agents panel
    Then the panel shows Your coding agents' own call to action from the prototype
    And it is not the empty state of AC9
    And once one row exists for Your coding agents the panel shows data

  @integration
  Scenario: AC26 A member inside the audience with the edit permission can edit
    Given a board set to team or organisation
    And a member inside that audience with analytics:update
    When that member opens the board
    Then they can edit it

  @integration
  Scenario: AC26 A member inside the audience without the edit permission sees no edit controls
    Given a board set to team or organisation
    And a member inside that audience without analytics:update
    When that member opens the board
    Then they see no edit controls
    And the server refuses their write

  @integration
  Scenario: AC26 Only the creator or an admin can change visibility or delete the board
    Given a board set to team or organisation
    And a member inside that audience who is neither its creator nor an admin
    When that member tries to change its visibility or delete it
    Then the server refuses the write
    And the creator or an admin can perform that same write

  @integration
  Scenario: AC26 The server refuses every write from a member outside the audience
    Given a board set to team or organisation
    And a member outside that audience
    When that member sends any write for the board
    Then the server refuses every one of those writes

  @integration
  Scenario: AC26 Narrowing a board with no recorded creator records who narrowed it
    Given a board with no recorded creator
    When a member sets it to only me or team
    Then that member is recorded as its creator
    And the board stays visible to them
    And a project credential cannot set it to only me or team

  @integration
  Scenario: AC26 An admin can manage a board they cannot see
    Given a board set to only me by another member
    When an admin changes its visibility or deletes it
    Then the server accepts the write
    And the board is still not listed or opened for the admin

  # --- AC Coverage Map ---
  # AC 1: "Flag off hides the area" → Scenario: AC1 Flag off hides the area
  # AC 2: "Landing on the Flight Deck" → Scenario: AC2 Landing on the Flight Deck
  # AC 3: "Sidebar matches the reference" → Scenario: AC3 Sidebar matches the reference
  # AC 4: "The ten panels in prototype order" → Scenario: AC4 The ten panels in prototype order
  # AC 5: "Status tiles compare with the previous period" → Scenario: AC5 Status tiles compare with the previous period
  # AC 6: "Unconnected source shows a call to action" → Scenario: AC6 Unconnected source shows a call to action
  # AC 7: "Connected state comes from real data" → Scenario: AC7 Connected state comes from real data
  # AC 8: "The Flight Deck cannot be edited" → Scenario: AC8 No edit controls appear on the Flight Deck; Scenario: AC8 The server rejects a write against the Flight Deck
  # AC 9: "Empty period" → Scenario: AC9 Empty period shows an empty state
  # AC 10: "Blank board matches the reference" → Scenario: AC10 Blank board matches the reference
  # AC 11: "Add a block by question" → Scenario: AC11 Ask Langy by question
  # AC 12: "Only working questions are offered" → Scenario: AC12 Only working questions are offered
  # AC 13: "Period and grain" → Scenario: AC13 Period and grain update every block; Scenario: AC13 Grain choices update every block
  # AC 14: "Rename and describe" → Scenario: AC14 Rename and describe
  # AC 15: "Block menu" → Scenario: AC15 Block menu actions persist after reload
  # AC 16: "Ask Langy from the board" → Scenario: AC16 Ask Langy from the board
  # AC 17: "Langy insights on a block" (sharpened) → Scenario: AC17 Langy insights on a block quote the block's own result
  # AC 18: "Visibility" → Scenario: AC18 Visibility hides a board from members outside its audience; Scenario: AC18 Blocks on a board follow the board's visibility; Scenario: AC18 Saved charts on a board follow the board's visibility
  # AC 19: "LWQL only" → Scenario: AC19 Every dashboard data request goes to LWQL and none to legacy analytics
  # AC 20: "Legacy analytics untouched" → Scenario: AC20 Legacy analytics files are untouched; Scenario: AC20 Legacy analytics pages behave exactly as before
  # AC 21: "Permissions" (sharpened) → Scenario: AC21 A member without analytics:view is refused; Scenario: AC21 A refused member sees the same not-found page
  # AC 22: "Gateway routing and coding agents ship in the state their data supports" → Scenario: AC22 An unqueryable source ships as a call to action; Scenario: AC22 A queryable source follows the normal panel rules
  # AC 23: "A failing query does not take the board down" → Scenario: AC23 A failing query does not take the board down
  # AC 24: "Boards created before this change keep working" (sharpened) → Scenario: AC24 Boards created before this change keep working
  # AC 25: "Every optional source has its own call to action" → Scenario: AC25 Scenario results shows its own call to action before any row exists; Scenario: AC25 Quality signal shows its own call to action before any row exists; Scenario: AC25 User feedback shows its own call to action before any row exists; Scenario: AC25 Gateway routing shows its own call to action before any row exists; Scenario: AC25 Your coding agents shows its own call to action before any row exists
  # AC 26: "Visibility changes who can see a board, not who can edit it" → Scenario: AC26 A member inside the audience with the edit permission can edit; Scenario: AC26 A member inside the audience without the edit permission sees no edit controls; Scenario: AC26 Only the creator or an admin can change visibility or delete the board; Scenario: AC26 The server refuses every write from a member outside the audience; Scenario: AC26 Narrowing a board with no recorded creator records who narrowed it; Scenario: AC26 An admin can manage a board they cannot see
