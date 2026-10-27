Feature: Dashboard CLI Commands
  As a developer or an agent building dashboards
  I want one `langwatch dashboard` command group for dashboards and their widgets
  So that I manage them from the terminal without the UI

  The group speaks /api/v1/dashboards, where the project comes from the API key.
  The older Analytics Reports live under `langwatch analytics-report`
  (specs/features/analytics-report-cli.feature).

  @unit
  Scenario: The dashboard group manages dashboards and the widgets on them
    Given the langwatch CLI
    Then `langwatch dashboard` offers list, get, create, update and delete
    And `langwatch dashboard widget` offers schema, list, get, add, update and delete
    And `langwatch dashboard widget add <dashboardId>` creates the widget on that dashboard
    And every one of them answers in the format `-f` names

  @unit
  Scenario: A dashboard update refuses a new description and clearing it at once
    When I run "langwatch dashboard update d_1 --description x --clear-description"
    Then the CLI refuses the two options together and sends no request
