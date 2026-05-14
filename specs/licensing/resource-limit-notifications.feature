@unit
Feature: Internal Slack Notifications for Resource Limit Reached

  As a LangWatch ops team member
  I want to receive Slack notifications when organizations hit resource limits
  So that I can proactively reach out and help them upgrade

  Background:
    Given an organization "Acme Corp" on the "Launch" plan

  # KEPT @unimplemented: 24h cooldown logic is not implemented in
  # notification.service.ts (notifyResourceLimitReached fires on every hit
  # without dedup state). Bindable once the dedup table + clock-aware test
  # harness is added.
  @unimplemented
  Scenario: Notification resumes after cooldown expires
    Given a resource limit notification for "workflows" was sent more than 24 hours ago
    When a user attempts to create a workflow and the limit is reached
    Then a Slack notification is sent

  # KEPT @unimplemented: existing notification service tests cover the
  # Slack-channel side, but explicit "no-CRM-notification" assertion is
  # missing. Cheap follow-up but out of parity scope.
  @unimplemented
  Scenario: Only internal ops team is notified, not CRM
    Given resource limit notifications are configured
    When a resource limit is reached
    Then an internal alert is sent to the ops team
    And no customer-facing or sales notifications are sent
