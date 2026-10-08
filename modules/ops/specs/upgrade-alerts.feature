@ops @upgrades
Feature: Upgrade alerts reach platform operators
  An upgrade that fails, or a runner that dies holding the lease, is told to the platform
  operators once: an email through the notification edge, and a Slack message where ops'
  notifier is configured (ruling Q-U7). Operators also see a banner while the installation is
  Behind, Unsupported or Needs attention. Plan: dev/docs/plans/upgrade-ui-2026-10-06.md 6.2, W9.

  Rule: The hourly check alerts on what changed since the last wake

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

  Rule: Alerts go to platform operators by email, and to Slack only where configured

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
      Then no email is sent and no Slack message is posted

    @unit
    Scenario: Slack hears the alert only where ops' notifier is configured
      Given ops' upgrade alert notifier is configured
      And a step failed since the last wake
      When the upgrade alert check runs
      Then the notifier is given the same alerts as the email

  Rule: The operator banner reads the upgrade status already served to operators

    @integration
    Scenario: The banner shows while the installation needs an operator
      Given the upgrade status is Behind, Unsupported or Needs attention
      When a platform operator opens any page
      Then a banner names the state and links to the Upgrades page

    @integration
    Scenario: The banner stays hidden while the installation is up to date
      Given the upgrade status is Up to date
      When a platform operator opens any page
      Then no upgrade banner is shown
