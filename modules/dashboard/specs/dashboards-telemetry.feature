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
    When a member asks Langy from a board or a widget
    Then "dashboards.asked.langy" is sent
    And it says whether the ask was sent as a question or seeded as a draft

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

  @unit
  Scenario: Telemetry: the caller is set by the server from the door the query came in by
    Given a query from a dashboard widget, the workbench, the REST API or a saved chart
    Then its caller is "dashboard_widget", "workbench", "rest_api" or "saved_chart"
    And the browser never names the caller itself
