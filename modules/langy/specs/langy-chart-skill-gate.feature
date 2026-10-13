Feature: Langy's chart skill follows the Dashboards flag

  Dashboard widgets open with two flags only: `release_dashboards` and
  `release_lwql_workbench`. Langy offers exactly one chart-authoring skill,
  `dashboard-widgets` or `lwql-charts`, and the Dashboards flag alone picks
  which; the custom chart playground flag plays no part in it.

  @unit
  Scenario: Langy builds dashboard widgets when Dashboards is on
    Given a project with `release_dashboards` on and `release_custom_chart_playground` off
    When Langy resolves which chart skill to hide
    Then it hides `lwql-charts` and offers `dashboard-widgets`
    And it never asks the custom chart playground flag

  @unit
  Scenario: Langy builds saved charts when Dashboards is off
    Given a project with `release_dashboards` off
    When Langy resolves which chart skill to hide
    Then it hides `dashboard-widgets` and offers `lwql-charts`
