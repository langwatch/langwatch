Feature: Scenario CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage scenarios via CLI commands
  So that I can define and maintain agent test scenarios without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List scenarios
    Given my project has scenarios configured
    When I run "langwatch scenario list"
    Then I see a table of all scenarios with name, labels, and criteria count

  Scenario: List scenarios when none exist
    Given my project has no scenarios
    When I run "langwatch scenario list"
    Then I see a message indicating no scenarios were found

  Scenario: Get scenario details by ID
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario get <scenario-id>"
    Then I see scenario details including name, situation, criteria, and labels

  Scenario: Get scenario that does not exist
    When I run "langwatch scenario get nonexistent-id"
    Then I see an error that the scenario was not found

  Scenario: Create a scenario
    When I run "langwatch scenario create 'Login Flow' --situation 'User attempts to log in'"
    Then a new scenario is created and I see confirmation with its name and ID

  Scenario: Create a scenario with criteria and labels
    When I run "langwatch scenario create 'Login Flow' --situation 'User logs in' --criteria 'Greets user,Asks for password' --labels 'auth,happy-path'"
    Then a new scenario is created with the specified criteria and labels

  Scenario: Create a scenario without required situation
    When I run "langwatch scenario create 'Login Flow'"
    Then I see an error that the --situation option is required

  Scenario: Update a scenario
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario update <scenario-id> --name 'Updated Login Flow'"
    Then the scenario is updated and I see confirmation

  Scenario: Update a scenario with new criteria
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario update <scenario-id> --criteria 'New criterion 1,New criterion 2'"
    Then the scenario criteria are replaced with the new values

  Scenario: Delete (archive) a scenario
    Given my project has a scenario with name "Login Flow"
    When I run "langwatch scenario delete <scenario-id>"
    Then the scenario is archived and I see confirmation

  Scenario: Delete a scenario that does not exist
    When I run "langwatch scenario delete nonexistent-id"
    Then I see an error that the scenario was not found

  Scenario: Run scenario command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch scenario list"
    Then I see an error prompting me to configure my API key
