Feature: Internal Slack Notifications for Plan Limit Reached

  As a LangWatch ops team member
  I want the plan limit alert to say which cap was hit and how far over it is
  So that I can act on it without opening the admin panel first

  Background:
    Given an organization "Acme" whose admin is "someone@acme.com"
    And the internal plan limit Slack channel is configured

  @unit
  Scenario: Plan limit alert names the monthly trace cap and the numbers
    Given the organization is on the "Free" plan metered in traces
    When the organization goes over 10000 traces for the month
    Then the Slack alert reads "Plan limit reached: Acme, someone@acme.com, Plan: Free, Monthly Traces: 12000/10000"

  @unit
  Scenario: Plan limit alert names the monthly event cap and the numbers
    Given the organization is on the "Free" plan metered in events
    When the organization goes over 10000 events for the month
    Then the Slack alert reads "Plan limit reached: Acme, someone@acme.com, Plan: Free, Monthly Events: 12000/10000"

  @unit
  Scenario: Plan limit alert reads the same way as the resource limit alert
    Given the organization has gone over its monthly trace cap
    And the organization has also filled every team member seat
    Then both Slack alerts list the organization, the admin, the plan, and the limit with its current and maximum

  @unit
  Scenario: Plan limit alert still sends when the organization has no admin email
    Given the organization has no admin email on record
    When the organization goes over its monthly cap
    Then the Slack alert reads "unknown" in place of the admin email and still carries the limit and the numbers
