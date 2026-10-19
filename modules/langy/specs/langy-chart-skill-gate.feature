Feature: Langy's chart skill follows the Dashboards flag

  Dashboard widgets open with two flags only: `release_dashboards` and
  `release_lwql_workbench`. Langy offers exactly one chart-authoring skill,
  `dashboard-widgets` or `lwql-charts`, and the Dashboards flag alone picks
  which.

  @unit
  Scenario: Langy builds dashboard widgets when Dashboards is on
    Given a project with `release_dashboards` on
    When Langy resolves which chart skill to hide
    Then it hides `lwql-charts` and offers `dashboard-widgets`

  @unit
  Scenario: Langy builds saved charts when Dashboards is off
    Given a project with `release_dashboards` off
    When Langy resolves which chart skill to hide
    Then it hides `dashboard-widgets` and offers `lwql-charts`

  # Whichever skill is offered, it places on the board the user named, never one
  # it picked itself (QA on main put a chart on "Shop assistant health").
  @unit
  Scenario: Langy places a chart on the dashboard in context and asks when none is
    Given either chart skill, `dashboard-widgets` or `lwql-charts`
    When Langy is about to place a chart on a dashboard
    Then the skill says to use the dashboard in the user's context
    And when no dashboard is in context, to ask which board with the question tool
    And never to pick one from `langwatch dashboard list` on its own
