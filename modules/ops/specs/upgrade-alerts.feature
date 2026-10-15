@ops @upgrades
Feature: Upgrade alerts reach platform operators
  An upgrade that fails, or a runner that dies holding the lease, is told once to this
  installation's own platform operators by email through the notification edge. Upgrades are a
  self-hosted concern, so nothing goes to LangWatch's Slack. Plan: dev/docs/plans/upgrade-ui-2026-10-06.md 6.2, W9.

  Rule: The hourly check alerts on what changed since the last wake

    @unit
    Scenario: Each wake checks the window since the previous wake
      Given the upgrade alert check last woke an hour ago
      When it wakes again
      Then it asks for one check covering the time since that wake, keyed by this wake

    @unit
    Scenario: A step that failed since the last wake is alerted
      Given the ledger holds a step that failed 10 minutes ago
      When the upgrade alert check wakes
      Then one alert names that step and its error

    @unit
    Scenario: A step that failed before the last wake is not alerted again
      Given the ledger holds a step that failed two hours ago
      When the upgrade alert check wakes
      Then no alert is raised

    @unit
    Scenario: A lease that expired since the last wake is alerted as a runner that died
      Given the ledger's upgrade lease expired 5 minutes ago
      When the upgrade alert check wakes
      Then one alert says the upgrade runner stopped holding its lease

    @unit
    Scenario: A lease a live runner still holds is not alerted
      Given the ledger's upgrade lease expires in 5 minutes
      When the upgrade alert check wakes
      Then no alert is raised

  Rule: Alerts go to the installation's platform operators by email

    @unit
    Scenario: Each platform operator with an email address gets the alert once per wake
      Given two platform operators, one without an email address
      And a step failed since the last wake
      When the upgrade alert check runs
      Then one email is sent, to the operator with an address
      And its idempotency key names the wake and the recipient

    @unit
    Scenario: Nothing is sent when nothing changed
      Given no step failed and no lease expired since the last wake
      When the upgrade alert check runs
      Then no email is sent
