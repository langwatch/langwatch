Feature: Analytics Reports CLI Commands
  As a developer managing Analytics Reports
  I want to create and manage Analytics Reports via CLI
  So that I can set up monitoring without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List Analytics Reports
    Given my project has Analytics Reports
    When I run "langwatch analytics-reports list"
    Then I see a table of Analytics Reports with name, ID, graph count, and last updated

  Scenario: List Analytics Reports as JSON
    When I run "langwatch analytics-reports list -f json"
    Then I see raw JSON with Analytics Report data

  Scenario: Create an Analytics Report
    When I run "langwatch analytics-reports create 'Performance Overview'"
    Then a new Analytics Report is created and I see confirmation with its name and ID

  Scenario: Delete an Analytics Report
    Given my project has an Analytics Report with ID "dash_123"
    When I run "langwatch analytics-reports delete dash_123"
    Then the Analytics Report is deleted and I see confirmation

  Scenario: Run an Analytics Reports command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch analytics-reports list"
    Then I see an error prompting me to configure my API key

  Scenario: The old dashboard command still works, deprecated
    When I run "langwatch dashboard list"
    Then I see the same table as "langwatch analytics-reports list"
    And stderr says "langwatch dashboard" is deprecated and names "langwatch analytics-reports"
