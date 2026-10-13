@coding-agent
Feature: The CLI declares which coding-agent session it runs under

  @unit
  Scenario: Codex session resolved from ancestor holding rollout
    Given a Codex session whose process is an ancestor of the CLI
    When the CLI declares its ingestion context
    Then it declares for that session
    And it still does while a second session is mid-turn
