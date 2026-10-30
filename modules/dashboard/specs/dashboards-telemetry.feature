Feature: Dashboards telemetry: product events and query telemetry
  As the team that ships dashboards
  I want to know who opens, builds and edits boards, and how their queries behave in prod
  So that we can see whether dashboards and Langy help, and catch slow or failing queries
  # Owner said: "I want something working on the dashboard usage/telemetry stuff in the
  # background. Can we not do that together in 1pr?"
  # Sources: langwatch/tasks#1003 (product events) and langwatch/tasks#1005 (query telemetry).
  # Every product event goes through useUiAnalytics() with the boundary "dashboards", so its
  # name reads "dashboards.<action>.<name>". Attributes never carry a raw id or any SQL.

  # ---------------------------------------------------------------------------
  # Product events (#1003)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Telemetry: opening a board sends dashboards.viewed.dashboard
    Given a member opens a stored board, or a From LangWatch board
    When its widgets have loaded
    Then "dashboards.viewed.dashboard" is sent once for that board
    And it carries dashboardKind "stored" or "curated" and the widgetCount
    And a From LangWatch board also carries its templateId

  @unit
  Scenario: Telemetry: making a board sends dashboards.created.dashboard with where it came from
    Given a member makes a board blank, from a template, as a copy of a board, or as a copy of a From LangWatch board
    When the board is made
    Then "dashboards.created.dashboard" is sent with createdFrom "blank", "template", "duplicate" or "duplicate_curated"
    And a board from a template also carries its templateId
    And a board that fails to be made sends nothing

  @unit
  Scenario: Telemetry: adding, saving and deleting a widget each send their own event
    Given a member changes the widgets on a board
    When a widget lands from the catalogue, the editor or a duplicate
    Then "dashboards.added.widget" is sent with addedFrom "catalogue", "editor" or "duplicate"
    When a widget's edit is saved
    Then "dashboards.edited.widget" is sent
    When a widget is deleted
    Then "dashboards.deleted.widget" is sent
    And a change the server refuses sends nothing

  @unit
  Scenario: Telemetry: deleting a board sends dashboards.deleted.dashboard
    When a member deletes a board and the server agrees
    Then "dashboards.deleted.dashboard" is sent

  @unit
  Scenario: Telemetry: asking Langy from a board sends dashboards.asked.langy
    When a member puts a question to Langy from a board: a suggested question under the ask bar, or the question typed in "Add a widget"
    Then "dashboards.asked.langy" is sent once

  @unit
  Scenario: Telemetry: a draft the app seeds in Langy sends no ask
    Given the app seeds a Langy draft by itself
    When a widget is added from the catalogue, "Edit code" opens, "Duplicate to edit" makes a copy, or a template board is made
    Then no "dashboards.asked.langy" is sent

  @unit
  Scenario: Telemetry: changing whether a widget counts Langy traces sends dashboards.toggled.langy_traces
    Given a widget whose queries store their sources
    When a member saves the widget with Langy traces added or taken away
    Then "dashboards.toggled.langy_traces" is sent with included true or false
    And a save that leaves the sources as they were sends no toggle

  @unit
  Scenario: Telemetry: starring a board sends dashboards.favourited.dashboard
    When a member stars or unstars a board or a template and the server agrees
    Then "dashboards.favourited.dashboard" is sent with starred true or false

  @integration
  Scenario: Telemetry: every later event carries the project in scope
    Given a signed-in member in a project
    Then analytics registers projectId as a property every later event carries
    When the member moves to another project
    Then projectId changes to the new project
    When no project is in scope
    Then projectId is no longer registered

  @integration
  Scenario: Telemetry: a reload with no project in scope drops the projectId kept from before
    Given analytics kept projectId from an earlier page load
    When the app loads with no project in scope
    Then analytics unregisters projectId straight away

  # ---------------------------------------------------------------------------
  # Engagement events: what a member does on a board after opening it
  # Sources: the owner's review of the telemetry PR, the "PR 1" rows of the event table in
  # https://github.com/langwatch/langwatch/pull/9190#issuecomment-6520995840.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Telemetry: a board view carries a one-way board key, never the board id
    When a member opens a board
    Then "dashboards.viewed.dashboard" carries a dashboardKey of 16 hex characters
    And the same board always gives the same dashboardKey
    And the dashboardKey is not the board id

  @integration
  Scenario: Telemetry: a widget on screen sends dashboards.viewed.widget once per board view
    Given a member has a board open
    When half of the widget's card first shows on screen
    Then "dashboards.viewed.widget" is sent once with widgetSource "catalogue", "langy", "code", "api", "curated" or "unknown"
    And the card showing again in the same view sends nothing more
    And a card with less than half of the widget on screen sends nothing

  @integration
  Scenario: Telemetry: picking a board period sends dashboards.changed.period
    When a member picks another range or grain on a board
    Then "dashboards.changed.period" is sent with the range and grain now in use
    And picking the range or grain already in use sends nothing

  @integration
  Scenario: Telemetry: exporting a widget sends dashboards.exported.widget
    When a member downloads a widget's rows as CSV
    Then "dashboards.exported.widget" is sent with format "csv"

  @integration
  Scenario: Telemetry: renaming a board or saving its layout sends dashboards.edited.dashboard
    When a member renames a board and the server agrees
    Then "dashboards.edited.dashboard" is sent with change "rename"
    When a member drops a widget in a new place and the layout is saved
    Then "dashboards.edited.dashboard" is sent once with change "layout"
    And a rename or layout the server refuses sends nothing

  @integration
  Scenario: Telemetry: opening the widget editor sends lwql.opened.editor
    # The widget editor is where a member writes and runs LangWatchQL: its Queries tab runs queries.
    When a member opens the editor on a new widget or a saved one
    Then "lwql.opened.editor" is sent once with widgetIs "new" or "existing"

  @integration
  Scenario: Telemetry: running a query in the widget editor sends lwql.ran.query
    When a member presses Run on a query in the widget editor
    Then "lwql.ran.query" is sent once
    And it carries no query text and no SQL

  # ---------------------------------------------------------------------------
  # Query telemetry (#1005)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Telemetry: the query log line says who ran it and how it ended
    When a LangWatchQL query runs
    Then its "LangWatchQL executed" log line carries caller, outcome and queryHash
    And a widget's run also carries its dashboardId, widgetId and templateId when it has them
    And queryHash is a hash of the whitespace-normalised SQL, never the SQL text
    And outcome is "ok" when rows came back and "empty" when none did

  @unit
  Scenario: Telemetry: a failed query is logged and counted with its error code
    When a LangWatchQL query is refused or fails
    Then a "LangWatchQL failed" log line carries the caller, the queryHash and the error code
    And lwql_queries_total counts it with outcome set to that error code

  @unit
  Scenario: Telemetry: query metrics carry only low-cardinality labels
    When a LangWatchQL query runs
    Then lwql_queries_total counts it by caller and outcome
    And lwql_query_duration_seconds and lwql_rows_read record it by caller
    And no metric label carries a project, dashboard or widget id

  @integration
  Scenario: Telemetry: a From LangWatch board's widgets count as dashboard widgets
    Given a member opens a From LangWatch board
    When its widgets run their queries
    Then each run sends the board as "curated/<template id>", the widget's key as its widgetId and as its templateId
    And the server counts it under the caller "dashboard_widget"
    And only the widget editor's preview and the workbench count as "workbench"

  @unit
  Scenario: Telemetry: the caller is set by the server from the door the query came in by
    Given a query from a dashboard widget, the workbench, the REST API or a saved chart
    Then its caller is "dashboard_widget", "workbench", "rest_api" or "saved_chart"
    And the browser never names the caller itself
