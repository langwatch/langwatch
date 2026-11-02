Feature: Analytics Reports CLI Commands
  As a developer managing Analytics Reports
  I want to create and manage Analytics Reports via CLI
  So that I can set up monitoring without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List Analytics Reports
    Given my project has Analytics Reports
    When I run "langwatch analytics-report list"
    Then I see a table of Analytics Reports with name, ID, graph count, and last updated

  Scenario: List Analytics Reports as JSON
    When I run "langwatch analytics-report list -f json"
    Then I see raw JSON with Analytics Report data

  Scenario: Create an Analytics Report
    When I run "langwatch analytics-report create 'Performance Overview'"
    Then a new Analytics Report is created and I see confirmation with its name and ID

  Scenario: Delete an Analytics Report
    Given my project has an Analytics Report with ID "dash_123"
    When I run "langwatch analytics-report delete dash_123"
    Then the Analytics Report is deleted and I see confirmation

  Scenario: Run an analytics-report command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch analytics-report list"
    Then I see an error prompting me to configure my API key
