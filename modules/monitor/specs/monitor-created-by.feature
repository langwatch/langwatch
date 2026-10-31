Feature: Monitors record who created and last changed them
  As a LangWatch user looking at an online evaluation
  I want to see who created it and who changed it last
  So that I know whom to ask about a monitor that paused itself or misbehaves

  @unit
  Scenario: Creating a monitor records its creator
    When a user creates a monitor
    Then the monitor records that user as its creator and last updater

  @unit
  Scenario: Updating a monitor records the last updater
    Given a monitor created by "Ada"
    When "Grace" changes its sampling
    Then the monitor keeps "Ada" as its creator and records "Grace" as its last updater

  @unit
  Scenario: Monitors created before creators were recorded show no creator
    Given a monitor with no recorded creator
    When the monitor is read
    Then its creator is null

  @integration
  Scenario: Monitor changes are audited
    When a user creates, updates, toggles or deletes a monitor through the tRPC procedures
    Then each change is written to the audit log under "monitors.*"

  @integration
  Scenario: The online evaluations list shows who created each monitor
    Given a monitor created by "Ada"
    When the online evaluations screen lists it
    Then its row shows "Created by Ada"
