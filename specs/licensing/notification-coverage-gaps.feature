@unit
Feature: Complete notification coverage for all limit enforcement paths

  As a LangWatch ops team member
  I want Slack notifications for every limit-blocked interaction
  So that no customer hitting a limit goes unnoticed regardless of enforcement path

  Background:
    Given an organization "Acme Corp" on the "Launch" plan

  # --- Backend: member-seat enforcement lives in InviteService ---
  # Member and lite-member invite limits are the only creation limits left:
  # InviteService.checkLicenseLimits resolves the org's seat counts and throws
  # LimitExceededError, then the invite mutation fires the ops Slack alert.
  # Projects, teams, and experimentation resources are OSS/uncapped and have no
  # limit-notification path.

  # A refusal records organization's seat-limit event; the worker's subscriber
  # tells billing, which sends the Slack alert (resource-limit-notifications).
  Scenario: Member invite triggers notification when limit reached
    Given the organization has reached the maximum number of full members
    When a user sends an invite for a full member
    Then the invite is rejected
    And a Slack notification is sent to the ops team

  Scenario: Lite member invite triggers notification when limit reached
    Given the organization has reached the maximum number of lite members
    When a user sends an invite for a lite member
    Then the invite is rejected
    And a Slack notification is sent to the ops team

  @integration
  Scenario: Role change refused at a seat limit triggers notification
    Given the organization has reached the maximum number of full members
    When an admin promotes a lite member to a full member
    Then the role change is rejected
    And a Slack notification is sent to the ops team
