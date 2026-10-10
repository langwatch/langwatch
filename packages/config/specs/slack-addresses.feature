Feature: Slack's addresses are shared leaves
  As the team running a dev stack beside real customers' Slack workspaces
  I want the Slack Web API base and the incoming-webhook origin declared once in @langwatch/config
  So that slack and automation both reach Slack, or the stand-in haven names, without a collision

  # ARCHITECTURE.md §6: a shared deployment fact is one leaf every claimant picks.

  @unit
  Scenario: Slack's addresses default to Slack itself
    Given slack and automation both hold the exported Slack address leaves
    When the process parses its config with neither SLACK_API_BASE nor SLACK_WEBHOOK_BASE set
    Then both slices carry https://slack.com/api and https://hooks.slack.com

  @unit
  Scenario: A dev stack points Slack's addresses at a stand-in
    Given slack and automation both hold the exported Slack address leaves
    When the process parses its config with SLACK_API_BASE and SLACK_WEBHOOK_BASE set
    Then both slices carry the stand-in's addresses
