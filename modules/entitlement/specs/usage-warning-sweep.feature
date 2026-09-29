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
  Scenario: Entitlement decides the warning and billing only sends it
    Given an organization at 90% of its monthly limit
    When its usage-limit warning is checked
    Then billing is asked to send the 90% threshold with each project's count this month
    And the month is counted once, by entitlement

  @unit @entitlements
  Scenario: A reading below every warning threshold sends nothing and counts nothing
    Given an organization at 10% of its monthly limit
    When its usage-limit warning is checked
    Then billing is not asked to send and no project is counted

  @unit @entitlements
  Scenario: A warning whose per-project usage could not be counted is not sent
    Given an organization above a warning threshold whose per-project usage is unknown
    When its usage-limit warning is checked
    Then billing is not asked to send and the check reports nothing sent
