Feature: Daily usage-limit warning sweep
  As LangWatch Cloud
  I want every organization's monthly usage checked once a day
  So that administrators hear about an approaching limit before messages are dropped

  @unit @entitlements
  Scenario: The sweep warns each organization against its plan's monthly limit
    Given an organization with a project, 900 messages this month and a plan allowing 1000
    When the daily sweep runs
    Then the warning is checked with 900 of 1000

  @unit @entitlements
  Scenario: The sweep passes over organizations it cannot or need not warn
    Given organizations with no projects, an unlimited plan, or usage that could not be counted
    When the daily sweep runs
    Then no warning is checked for any of them, and one failing organization does not stop the rest

  @unit @entitlements
  Scenario: The sweep does nothing off Cloud
    Given a self-hosted deployment
    When the daily sweep runs
    Then no organization is read and no warning is checked

  @unit @entitlements
  Scenario: A project whose team was deleted does not stop the usage-warning sweep
    Given a project whose team no longer exists, alongside projects in live teams
    When the daily sweep lists the organizations to check
    Then the organizations of the live teams are listed and the orphan project is skipped
