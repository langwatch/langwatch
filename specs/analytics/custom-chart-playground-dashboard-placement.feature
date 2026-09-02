Feature: Dashboard widgets placed on a dashboard

  A persisted dashboard widget is a `CustomGraph` row of kind
  `dashboard_srcdoc`, the same table a builder graph or a placed workbench
  chart uses (see specs/analytics/lwql-saved-charts.feature for the workbench
  precedent this mirrors). Placement was previously refused everywhere: the
  card-level procedures never admitted the kind, so a widget with a
  `dashboardId` still never appeared on the grid. This feature opens that
  gate behind `release_custom_chart_playground`, the same flag that gates the
  playground page and its REST/CLI surface, and gives the grid a read-only
  renderer for the kind — no dashboard-side edit drawer yet, editing stays on
  the playground page.

  Unlike the mutual exclusion between `chart`/`graph` WRITES and
  `dashboard-widget` WRITES (release_custom_chart_playground turns the
  former off), placement is not mutually exclusive: a project can carry
  `workbench_sql` rows placed before the playground shipped and
  `dashboard_srcdoc` rows side by side, and both must keep rendering
  regardless of which flags are on, because deleting neither is this
  feature's job.

  Background:
    Given a dashboard grid

  @unit
  Scenario: The dashboard's card procedures admit dashboard-widget rows only when the flag is on
    Given a dashboard holding a dashboard widget
    When the card procedures run with the flag on and again with it off
    Then with the flag on the `kind` clause includes dashboard_srcdoc
    And with the flag off the `kind` clause is exactly the same as before the feature existed

  @unit
  Scenario: Workbench and dashboard-widget rows are both admitted when both flags are on
    Given a dashboard holding a saved workbench chart and a dashboard widget
    When the card procedures run with both flags on
    Then the `kind` clause admits builder, workbench_sql and dashboard_srcdoc together

  @unit
  Scenario: The dashboard-widget flag does not change workbench visibility, or the reverse
    Given a dashboard holding a saved workbench chart placed before the playground shipped
    When the dashboard-widget flag is on and the workbench flag is off
    Then the `kind` clause admits dashboard_srcdoc but not workbench_sql, because each kind is gated on its own flag alone

  @integration
  Scenario: A dashboard widget card draws the sandboxed widget, not the builder
    Given a dashboard grid holding a dashboard widget
    When the card is rendered
    Then the sandboxed dashboard widget frame draws it, with the row's own code and queries, and the builder renderer is not mounted

  @integration
  Scenario: A dashboard widget card is not offered an alert it cannot evaluate
    Given a dashboard grid holding a dashboard widget
    When the card is rendered
    Then no add-alert control is offered, because sandboxed author code has no series to threshold

  @integration
  Scenario: A dashboard widget card's Edit action opens the playground page
    Given a dashboard grid holding a dashboard widget
    When the card's menu is opened
    Then Edit is labelled "Open in playground" and navigates to the custom-chart-playground page, not the builder or workbench editor

  @integration
  Scenario: A placed dashboard widget follows the dashboard's period control
    Given a dashboard grid holding a dashboard widget
    When the dashboard's period selector changes
    Then the widget's queries re-run against the new period, the same one control every other card on the grid reads
