Feature: Prompt Version Management CLI Commands
  As a developer using LangWatch from the terminal
  I want to list and restore prompt versions via CLI commands
  So that I can track version history and rollback to previous configurations

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List prompt versions
    Given my project has a prompt "pizza-prompt" with multiple versions
    When I run "langwatch prompt versions pizza-prompt"
    Then I see a table of versions with version number, ID, commit message, and date

  Scenario: List prompt versions in JSON format
    Given my project has a prompt "pizza-prompt" with multiple versions
    When I run "langwatch prompt versions pizza-prompt --format json"
    Then I see the versions as a JSON array

  Scenario: Restore a prompt to a previous version
    Given my project has a prompt "pizza-prompt" with version "v2" having ID "ver_abc"
    When I run "langwatch prompt restore pizza-prompt ver_abc"
    Then a new version is created with the same config as version v2
    And I see confirmation with the new version number

  Scenario: Restore with non-existent version ID
    Given my project has a prompt "pizza-prompt"
    When I run "langwatch prompt restore pizza-prompt nonexistent_id"
    Then I see an error that the version was not found
