Feature: Duplicate a prompt
  As a LangWatch user
  I want to duplicate an existing prompt into the same project
  So that I can iterate on a variation without editing the original

  # Distinct from "Replicate to another project", which copies a prompt across
  # project boundaries. Duplicating never leaves the project it started in.

  Background:
    Given I am logged into project "my-project"
    And a prompt named "support-bot" exists in the project

  @integration
  Scenario: A user duplicates a prompt from the prompt row menu
    When I choose "Duplicate prompt" from the prompt's overflow menu
    Then a new prompt named "support-bot-1" exists in the project
    And the original prompt "support-bot" is unchanged

  @integration
  Scenario: Duplicating the same prompt twice produces two distinct prompts
    When I duplicate "support-bot" twice
    Then a prompt named "support-bot-1" exists in the project
    And a prompt named "support-bot-2" exists in the project

  @integration
  Scenario: A duplicated prompt keeps the original's configuration
    Given the prompt "support-bot" has a model, a system prompt, and input variables configured
    When I duplicate "support-bot"
    Then the duplicated prompt has the same model, system prompt, and input variables
    And the duplicated prompt starts its own version history

  @integration
  Scenario: A duplicated prompt stays in the project it was duplicated from
    When I duplicate "support-bot"
    Then the duplicated prompt belongs to project "my-project"

  @integration
  Scenario: Duplicating is blocked when the plan's prompt allowance is used up
    Given my organization has reached the number of prompts its plan allows
    When I try to duplicate "support-bot"
    Then I am told the prompt limit has been reached
    And no new prompt is created

  @integration
  Scenario: Duplicating a prompt that no longer exists reports it as missing
    Given the prompt "support-bot" has been deleted
    When I try to duplicate "support-bot"
    Then I am told the prompt could not be found
