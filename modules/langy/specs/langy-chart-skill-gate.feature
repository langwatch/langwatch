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

  # The dashboard-widgets skill also drives boards through `langwatch dashboards`
  # (/api/v1/dashboards). These rules keep that safe.
  @unit
  Scenario: The dashboard-widgets skill never picks a board for the user
    Given the `dashboard-widgets` skill
    When Langy needs a board and more than one fits
    Then the skill says never to pick one for the user
    And to ask with the question tool, one option per board from `langwatch dashboards list`

  @unit
  Scenario: The dashboard-widgets skill confirms before deleting a board or a widget
    Given the `dashboard-widgets` skill
    When Langy is about to run `langwatch dashboards delete` or `langwatch dashboards widgets delete`
    Then the skill says to confirm first with a choices card, and to run it only on Delete

  @unit
  Scenario: The dashboard-widgets skill reads dashboards_not_released as Dashboards being off
    Given the `dashboard-widgets` skill
    When a `langwatch dashboards` command answers 404 with `dashboards_not_released`
    Then the skill says Dashboards is switched off for the project
    And to tell the user and not retry
