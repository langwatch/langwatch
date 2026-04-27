Feature: Graph CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage custom graphs on dashboards via CLI commands
  So that I can create analytics visualizations without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List graphs
    Given my project has custom graphs
    When I run "langwatch graph list"
    Then I see a table of graphs with name, dashboard, position, and size

  Scenario: List graphs filtered by dashboard
    Given my project has graphs on multiple dashboards
    When I run "langwatch graph list --dashboard-id <dashboard-id>"
    Then I see only graphs belonging to that dashboard

  Scenario: List graphs when none exist
    Given my project has no custom graphs
    When I run "langwatch graph list"
    Then I see a message indicating no graphs were found

  Scenario: Create a graph on a dashboard
    Given my project has a dashboard
    When I run "langwatch graph create 'Cost Over Time' --dashboard-id <id> --graph '{"type":"line","metric":"total_cost"}'"
    Then a new graph is created and I see confirmation with its ID

  Scenario: Delete a graph
    Given my project has a custom graph
    When I run "langwatch graph delete <graph-id>"
    Then the graph is deleted and I see confirmation
