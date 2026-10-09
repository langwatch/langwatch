@skills
Feature: Coding agent cost and context skill
  As a developer whose coding agents send telemetry to LangWatch
  I want a skill that reads my own sessions and recommends the settings that cut cost and context
  So that I change the settings my data supports, with the saving I can expect

  # The skill is skills/coding-agent-cost/SKILL.mdx. It ships on the public
  # skills directory and to Langy. Its expected savings come from 105
  # organisations' Claude Code data and from the controlled runs documented in
  # docs/coding-agents/cost-experiments.mdx.

  @unit
  Scenario: The skill is published and ships to Langy
    Given the published skill set
    Then it includes coding-agent-cost as a feature skill
    And the compiled Langy copy of the skill matches its source

  @unit
  Scenario: Every recommendation names its exact settings.json key
    Given the rendered skill
    Then the model upgrade names the "model" setting with the "opus" alias
    And the compaction recommendation names the "autoCompactWindow" setting at 400000
    And the sub-agent model recommendation names the "subagentModel" setting
    And the API-key cache recommendation names the "promptCacheTtl" setting at "1h"

  @unit
  Scenario: Every expected saving says whether it was measured or estimated
    Given the rendered skill
    When each recommendation's saving is read
    Then each one is labelled measured or estimated

  @unit
  Scenario: Subscription users hear about usage, API-key users about cash
    Given the rendered skill
    Then it tells the agent to word a subscription user's saving as usage before plan limits
    And it shows USD to subscription users only as API-equivalent usage
    And it never recommends a five-minute main cache to a subscription user

  @unit
  Scenario: Settings go in settings.json, never in a shell export
    Given the rendered skill
    Then it warns that a settings.json env value overrides a shell export
    And every query it runs reads the coding agent views through langwatch query run
