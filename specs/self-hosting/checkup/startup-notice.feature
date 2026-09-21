Feature: The startup notice after an upgrade
  An install that starts reporting for the first time, or whose report changed
  shape, tells its administrators once, in the app, where they will see it. A
  line in a boot log scrolls past; a notice on the page stays until someone
  reads it and dismisses it. The notice names the page that lists every field
  and the checkup page where the report and its switches are.

  As an administrator of a self-hosted install
  I want to be told once when my install starts reporting or reports more
  So that I am prompted rather than enrolled in silence

  Background:
    Given a self-hosted install with usage reporting left on

  @unit
  Scenario: A fresh install shows the notice to an administrator
    Given the install has never minted an identity
    When an administrator opens the app
    Then the notice is shown

  @unit
  Scenario: The notice comes back when the report schema version moves
    Given an administrator dismissed the notice for schema version 1
    And the dictionary is now at schema version 2
    When an administrator opens the app
    Then the notice is shown

  @unit
  Scenario: A dismissed notice stays dismissed across restarts and browsers
    Given an administrator dismissed the notice for the current schema version
    When another administrator opens the app from another browser
    Then the notice is not shown

  @unit
  Scenario: The notice is never shown on LangWatch Cloud or with reporting switched off
    Given usage reporting is switched off with DISABLE_USAGE_STATS
    When an administrator opens the app
    Then the notice is not shown

  @integration
  Scenario: The notice names the two pages and can be dismissed
    When an administrator sees the notice
    Then it links the data and telemetry docs page
    And it links the checkup page
    And dismissing it records the dismissal
