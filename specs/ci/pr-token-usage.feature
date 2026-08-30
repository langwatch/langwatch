Feature: PR token usage comment
  As a reviewer
  I want a single comment stating what the coding agents spent on a pull request
  So that the cost of the work is visible next to the work itself

  The data comes from the LangWatch pull-request usage API
  (GET /api/coding-agent/pull-request-usage), which rolls a pull request's
  whole lifetime up into sessions, tokens and cost per contributor and agent.
  The workflow only reads and comments: it never gates a merge.

  Background:
    Given the pr-token-usage workflow runs on pull_request events
    And it identifies its own comment by the hidden marker "<!-- pr-token-usage -->"

  Scenario: A comment is posted when usage exists for the pull request
    Given LangWatch has recorded sessions for the pull request
    When the workflow runs
    Then a comment carrying the usage marker is posted exactly once

  Scenario: The existing comment is updated when new commits are pushed
    Given a pull request already has a comment carrying the usage marker
    When a new commit is pushed to the pull request branch
    Then the existing comment is updated in place
    And no additional comment is created

  Scenario: A pull request with no recorded usage gets no comment
    Given LangWatch has no sessions recorded for the pull request
    And the pull request has no comment carrying the usage marker
    When the workflow runs
    Then no comment is created
    And the workflow does not fail

  Scenario: An existing comment is refreshed even when usage drops to zero
    Given a pull request already has a comment carrying the usage marker
    And LangWatch now reports no sessions for the pull request
    When the workflow runs
    Then the existing comment is updated rather than left stale

  Scenario: A LangWatch outage never blocks the pull request
    Given the LangWatch API is unreachable or answers with an error
    When the workflow runs
    Then the workflow logs a warning and succeeds
    And no comment is created or modified

  Scenario: Pull requests from forks are skipped
    Given a pull request originates from a forked repository
    When the workflow is triggered
    Then no comment is attempted
    And the workflow does not fail

  Scenario: Rapid successive pushes do not create duplicate comments
    Given a pull request receives two pushes in quick succession
    When both workflow runs are triggered
    Then the earlier run is cancelled before it posts
    And the pull request carries exactly one usage comment

  @unit
  Scenario: The comment shows one row per contributor and agent
    Given a usage rollup with rows for two contributors
    When the comment body is built
    Then each contributor appears once with its agent, sessions, tokens and cost
    And a totals row sums them

  @unit
  Scenario: The comment carries a per-model breakdown
    Given a usage rollup with a model breakdown
    When the comment body is built
    Then each model's tokens and cost appear in a collapsed details section

  @unit
  Scenario: Costs the caller may not price render as unavailable
    Given a usage rollup whose cost fields are null
    When the comment body is built
    Then the cost cells render as an em dash rather than zero

  @unit
  Scenario: Token counts are written in full with thousands separators
    Given a usage rollup with a token count above one billion
    When the comment body is built
    Then the count is written in full with separators, never abbreviated

  @unit
  Scenario: Agent identifiers render as product names
    Given a usage row whose agent is "claude_code"
    When the comment body is built
    Then the agent renders as "Claude Code"
    And an unknown agent identifier falls back to a readable form of itself

  @unit
  Scenario: An unmapped pull request reads as no usage
    Given the LangWatch API answers that the pull request is not mapped
    When the response is interpreted
    Then it is treated as "no usage recorded" rather than an error
