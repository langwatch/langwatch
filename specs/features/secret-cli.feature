Feature: Project Secrets CLI Commands
  As a developer using LangWatch from the terminal
  I want to manage encrypted project secrets via CLI commands
  So that I can securely store API keys and credentials without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List secrets
    Given my project has secrets configured
    When I run "langwatch secret list"
    Then I see a table of secrets with name, ID, and last updated date
    And secret values are never displayed

  Scenario: List secrets when none exist
    Given my project has no secrets
    When I run "langwatch secret list"
    Then I see a message indicating no secrets were found

  Scenario: Get secret metadata by ID
    Given my project has a secret named "MY_API_KEY"
    When I run "langwatch secret get <secret-id>"
    Then I see secret metadata including name, ID, and timestamps
    And the secret value is not shown

  Scenario: Create a secret
    When I run "langwatch secret create MY_API_KEY --value 'sk-abc123'"
    Then a new secret is created and I see confirmation with its ID
    And the value is stored encrypted

  Scenario: Create a secret with invalid name
    When I run "langwatch secret create invalid-name --value 'test'"
    Then I see an error that the name must be UPPER_SNAKE_CASE

  Scenario: Create a duplicate secret
    Given my project has a secret named "MY_API_KEY"
    When I run "langwatch secret create MY_API_KEY --value 'new-value'"
    Then I see a conflict error that the secret already exists

  Scenario: Update a secret value
    Given my project has a secret named "MY_API_KEY"
    When I run "langwatch secret update <secret-id> --value 'new-sk-xyz'"
    Then the secret value is updated and I see confirmation

  Scenario: Delete a secret
    Given my project has a secret
    When I run "langwatch secret delete <secret-id>"
    Then the secret is deleted and I see confirmation

  Scenario: Output in JSON format
    Given my project has secrets configured
    When I run "langwatch secret list --format json"
    Then I see the secrets as a JSON array
