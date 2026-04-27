Feature: Trigger (Automation) CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage triggers via CLI commands
  So that I can set up automated alerts and actions without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List triggers
    Given my project has triggers configured
    When I run "langwatch trigger list"
    Then I see a table of triggers with name, action, status, and alert type

  Scenario: List triggers when none exist
    Given my project has no triggers
    When I run "langwatch trigger list"
    Then I see a message indicating no triggers were found

  Scenario: Get trigger details by ID
    Given my project has a trigger with name "Error Alert"
    When I run "langwatch trigger get <trigger-id>"
    Then I see trigger details including name, action, status, filters, and message

  Scenario: Create an email trigger
    When I run "langwatch trigger create 'Error Alert' --action SEND_EMAIL --alert-type CRITICAL"
    Then a new trigger is created and I see confirmation with its ID

  Scenario: Create a Slack trigger
    When I run "langwatch trigger create 'Slack Notify' --action SEND_SLACK_MESSAGE --slack-webhook https://hooks.slack.com/..."
    Then a new trigger is created with Slack action

  Scenario: Create a trigger with filters
    When I run "langwatch trigger create 'Filtered Alert' --action SEND_EMAIL --filters '{"error":["true"]}'"
    Then a new trigger is created with the specified filters

  Scenario: Update trigger to disable it
    Given my project has an active trigger
    When I run "langwatch trigger update <trigger-id> --active false"
    Then the trigger is deactivated

  Scenario: Delete a trigger
    Given my project has a trigger
    When I run "langwatch trigger delete <trigger-id>"
    Then the trigger is deleted and I see confirmation
