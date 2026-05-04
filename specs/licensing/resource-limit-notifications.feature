@unit
Feature: Internal Slack Notifications for Resource Limit Reached

  As a LangWatch ops team member
  I want to receive Slack notifications when organizations hit resource limits
  So that I can proactively reach out and help them upgrade

  Background:
    Given an organization "Acme Corp" on the "Launch" plan

  @unimplemented
  Scenario: Notification resumes after cooldown expires
    Given a resource limit notification for "workflows" was sent more than 24 hours ago
    When a user attempts to create a workflow and the limit is reached
    Then a Slack notification is sent

  @unimplemented
  Scenario: Only internal ops team is notified, not CRM
    Given resource limit notifications are configured
    When a resource limit is reached
    Then an internal alert is sent to the ops team
    And no customer-facing or sales notifications are sent
