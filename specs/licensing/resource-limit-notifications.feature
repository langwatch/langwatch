@unit
Feature: Internal Slack Notifications for Resource Limit Reached

  As a LangWatch ops team member
  I want to receive Slack notifications when organizations hit resource limits
  So that I can proactively reach out and help them upgrade

  Background:
    Given an organization "Acme Corp" on the "Launch" plan

  Scenario: A reached seat limit sends the ops team a Slack alert
    Given the organization's first admin is "Ana"
    When billing is told the "members" limit was reached at 5 of 5
    Then a Slack alert names the organization, "Ana", the plan and "Team Members" at 5/5

  Scenario: A repeat inside the cooldown sends nothing
    Given a resource limit alert for "members" was sent less than 24 hours ago
    When billing is told the "members" limit was reached again
    Then no Slack notification is sent

  Scenario: A failed alert is reported, never thrown, and lets the next one through
    Given the Slack alert cannot be sent
    When billing is told the "members" limit was reached
    Then the failure is reported to billing's error channel
    And the call succeeds
    And the next report is not held back by the cooldown

  # Organization's half waits on organization-process depending on
  # @langwatch/eventing (not linked yet); see the screens-directory handoff.
  @unimplemented
  Scenario: A confirmed blocked report records organization's seat-limit event
    Given the organization has used every member seat
    When a client reports its pre-check blocked somebody
    Then organization records a seat-limit-reached event

  @unimplemented
  Scenario: Organization's seat-limit event tells billing
    When organization's seat-limit-reached event is handled
    Then billing is told the limit type, current and max

  Scenario: Notification resumes after cooldown expires
    Given a resource limit notification for "members" was sent 24 hours ago or more
    When billing is told the "members" limit was reached again
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
