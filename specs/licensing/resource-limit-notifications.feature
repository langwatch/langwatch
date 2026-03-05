@unit
Feature: Internal Slack Notifications for Resource Limit Reached

  As a LangWatch ops team member
  I want to receive Slack notifications when organizations hit resource limits
  So that I can proactively reach out and help them upgrade

  Background:
    Given an organization "Acme Corp" on the "Launch" plan

  Scenario: Slack notification sent when a resource limit is reached
    Given the organization has reached the maximum number of workflows
    When a user attempts to create a workflow
    Then a Slack notification is sent with organization name, plan name, resource type, and usage counts
    And the user sees the upgrade modal

  Scenario: No duplicate notification within 24-hour cooldown
    Given a resource limit notification was already sent within the last 24 hours
    When a user attempts to create a workflow
    Then no Slack notification is sent

  Scenario: Cooldown applies across all limit types
    Given a resource limit notification was already sent for "workflows" within the last 24 hours
    When a user attempts to create an agent and the limit is reached
    Then no Slack notification is sent

  Scenario: Notification resumes after cooldown expires
    Given a resource limit notification was sent more than 24 hours ago
    When a user attempts to create a workflow and the limit is reached
    Then a Slack notification is sent

  Scenario: Notification failure does not block the user
    Given the Slack webhook is unreachable
    When a user attempts to create a workflow and the limit is reached
    Then the user sees the upgrade modal
    And the failure is captured for observability

  Scenario: Only Slack is notified, not HubSpot
    Given resource limit notifications are configured
    When a resource limit is reached
    Then a Slack notification is sent
    And no HubSpot notification is sent
