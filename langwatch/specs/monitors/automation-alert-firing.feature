Feature: Automations fire only when their conditions are met

  Automations (alert triggers) watch incoming traces and fire an action —
  email, Slack, add-to-dataset, add-to-annotation-queue — when a trace matches
  the conditions the user configured. An automation must fire ONLY for traces
  that actually satisfy every one of its conditions. An automation whose
  conditions are never satisfied must never fire.

  A common automation alerts on negative user feedback: a "thumbs down" on a
  reply. It must fire on a trace where the user gave a thumbs down, and must
  stay quiet for traces with no feedback or with a thumbs up.

  Scenario: A thumbs-down automation fires on a real thumbs-down trace
    Given an automation that alerts when a user gives a thumbs down
    And a trace where the user gave a thumbs down
    When the trace is processed
    Then the automation fires its action once for that trace

  Scenario: A thumbs-down automation stays quiet for a trace with no feedback
    Given an automation that alerts when a user gives a thumbs down
    And a trace where the user left no feedback
    When the trace is processed
    Then the automation does not fire

  Scenario: A thumbs-down automation stays quiet for a thumbs-up trace
    Given an automation that alerts when a user gives a thumbs down
    And a trace where the user gave a thumbs up
    When the trace is processed
    Then the automation does not fire

  Scenario: An automation does not fire when its condition is unmet
    Given an automation with a condition that the trace does not satisfy
    When the trace is processed
    Then the automation does not fire

  Scenario: An automation fires at most once per trace
    Given an automation that alerts when a user gives a thumbs down
    And a trace where the user gave a thumbs down
    When the trace is processed more than once
    Then the automation fires its action only once for that trace
