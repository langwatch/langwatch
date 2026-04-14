Feature: Dashboard CLI Commands
  As a developer managing analytics dashboards
  I want to create and manage dashboards via CLI
  So that I can set up monitoring without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List dashboards
    Given my project has dashboards
    When I run "langwatch dashboard list"
    Then I see a table of dashboards with name, ID, graph count, and last updated

  Scenario: List dashboards as JSON
    When I run "langwatch dashboard list -f json"
    Then I see raw JSON with dashboard data

  Scenario: Create a dashboard
    When I run "langwatch dashboard create 'Performance Overview'"
    Then a new dashboard is created and I see confirmation with its name and ID

  Scenario: Delete a dashboard
    Given my project has a dashboard with ID "dash_123"
    When I run "langwatch dashboard delete dash_123"
    Then the dashboard is deleted and I see confirmation

  Scenario: Run dashboard command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch dashboard list"
    Then I see an error prompting me to configure my API key
