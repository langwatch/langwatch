@integration
Feature: Internal Slack notifications for new signups
  As a LangWatch ops team member
  I want to receive a Slack notification when a new organization completes signup
  So that I can follow up on new accounts promptly

  Background:
    Given a user signs up with name "Jane Doe" and email "jane@example.com"
    And the new organization is named "Acme Corp"

  Scenario: Slack notification sent after onboarding creates the organization
    When the onboarding flow completes successfully
    Then a Slack notification is sent with the user name
    And the Slack notification includes the user email
    And the Slack notification includes the organization name

  Scenario: Slack notification includes optional campaign context when present
    Given the organization signup includes phone number "+31 20 123 4567"
    And the signup data includes utm campaign "launch-week"
    When the onboarding flow completes successfully
    Then a Slack notification is sent with the user name
    And the Slack notification includes the user email
    And the Slack notification includes the organization name
    And the Slack notification includes the phone number
    And the Slack notification includes the utm campaign

  Scenario: Missing optional signup fields do not block the notification
    Given the organization signup has no phone number
    And the signup data has no utm campaign
    When the onboarding flow completes successfully
    Then a Slack notification is sent with the user name
    And the Slack notification includes the user email
    And the Slack notification includes the organization name

  Scenario: Missing Slack webhook does not block onboarding completion
    Given the signup Slack webhook is not configured
    When the onboarding flow completes successfully
    Then the organization is created successfully
    And no Slack notification is sent

  Scenario: Slack delivery failure does not block onboarding completion
    Given the signup Slack webhook is configured
    And the Slack webhook request fails
    When the onboarding flow completes successfully
    Then the organization is created successfully
    And the failure is captured for observability
