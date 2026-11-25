Feature: Dashboard widgets placed on a dashboard

  A persisted dashboard widget is a `CustomGraph` row of kind
  `dashboard_srcdoc`, the same table a builder graph or a placed workbench
  chart uses (see specs/lwql/saved-charts.feature for the workbench
  precedent this mirrors). Placement was previously refused everywhere: the
  card-level procedures never admitted the kind, so a widget with a
  `dashboardId` still never appeared on the grid. This feature opens that
  gate, gives the grid a renderer for the kind, and lets a member edit the
  widget in place from the card's menu.

  Dashboard widgets open with exactly two flags, everywhere: `release_dashboards`
  and `release_lwql_workbench`. That covers boards and the REST/CLI surface.
  Since the boards split (owner, 2026-10-15) a widget lives on a Dashboards board
  alone: the legacy Analytics reports page neither shows nor adds one.

  Placement is not mutually exclusive: a project can carry `workbench_sql`
  rows placed before widgets shipped and `dashboard_srcdoc` rows side by
  side, and both must keep rendering regardless of which flags are on,
  because deleting neither is this feature's job.

  Background:
    Given a dashboard grid

  @unit
  Scenario: The dashboard's card procedures admit workbench rows only when the workbench flag is on
    Given a dashboard holding a saved workbench chart
    When the card procedures run with the flag on and again with it off
    Then with the flag on the `kind` clause admits builder and workbench_sql
    And with the flag off the `kind` clause admits builder alone

  @integration
  Scenario: A placed dashboard widget follows the dashboard's period control
    Given a dashboard grid holding a dashboard widget
    When the dashboard's period selector changes
    Then the widget's queries re-run against the new period, the same one control every other card on the grid reads

  # Persistence invariants for the write path (dashboardWidget.service):
  # placement scoped to the target, dashboard ownership enforced, and partial
  # definition updates that do not blank the half the caller omitted.

  @integration
  Scenario: A widget's grid row is allocated from its target dashboard alone
    Given a dashboard already holding a tall card and a second, empty dashboard in the same project
    When a widget is created on the empty dashboard
    Then it is placed at the top of that dashboard, not pushed below the tall card on the other one

  @integration
  Scenario: A widget targeting a dashboard from another project is refused
    Given a dashboard owned by a different project
    When a widget create or an assignment names that dashboard
    Then it is refused as "not found", indistinguishable from a dashboard that never existed, and nothing is persisted or reassigned

  @integration
  Scenario: A partial widget definition update keeps the untouched half
    Given a saved widget with both author code and named queries
    When only the code is updated, or only the queries
    Then the side that was not sent is kept, not blanked, and the update is not silently dropped

  @unit
  Scenario: The create drawer places a new widget on the dashboard it names through dashboardWidgets.create
    Given a dashboard in a project with dashboard widgets open
    When a widget is created through dashboardWidgets.create naming that dashboard
    Then the widget is placed on that dashboard and answered in main's widget shape

  @unit
  Scenario: Every dashboard widget procedure is refused while dashboard widgets are closed
    Given a project with dashboard widgets closed
    When any dashboardWidgets procedure is called
    Then it is refused with the widget surface's own error code

  @unit
  Scenario: Dashboard widgets open with the Dashboards and LangWatchQL flags alone
    Given a project with `release_dashboards` and `release_lwql_workbench` on
    When the widget surface asks whether the project may use it
    Then the project is admitted

  @unit
  Scenario: Dashboard widgets stay closed while the Dashboards or the LangWatchQL flag is off
    Given a project with `release_dashboards` or `release_lwql_workbench` off
    When the widget surface asks whether the project may use it
    Then it is refused with the widget surface's own error code

  @integration
  Scenario: The legacy reports page neither shows nor adds dashboard widgets
    Given the legacy Analytics reports page, with `release_dashboards` and `release_lwql_workbench` on
    When a board is opened there
    Then only the charts made in Reports are drawn on its grid
    And "Add chart" links to the chart builder
