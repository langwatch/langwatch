Feature: Digest cadence for notification triggers

  Notification triggers (email and Slack) can batch matches into a digest
  window so a burst of matching traces does not produce a notification storm.
  Persist triggers (dataset / annotation queue) always write each match
  immediately, regardless of cadence.

  See dev/docs/adr/025-notify-persistent-action-classification.md.

  Background:
    Given a project with notifications enabled
    And an automation that notifies on traces matching a filter

  Scenario: Existing triggers keep firing immediately after the upgrade
    Given an automation that existed before the cadence feature shipped
    When a matching trace arrives
    Then the notification is sent immediately
    And the trigger's cadence is shown as "Immediate" in settings

  Scenario: New notification automations default to a 5-minute digest
    When the user creates a new email or Slack automation
    Then its cadence is "Every 5 minutes" by default
    And the cadence dropdown is visible in the automation settings

  Scenario: Persist automations do not expose a cadence
    When the user creates an automation that adds matches to a dataset
    Then the cadence dropdown is not shown
    And every matching trace is written to the dataset as it arrives

  Scenario Outline: A single match in the window sends one notification
    Given an automation with cadence "<cadence>"
    When one matching trace arrives within the window
    Then one notification is sent at the end of the window
    And the notification body references one trace

    Examples:
      | cadence              |
      | Every 5 minutes      |
      | Every 15 minutes     |
      | Every hour           |

  Scenario Outline: Multiple matches in the window are coalesced into one digest
    Given an automation with cadence "<cadence>"
    When <count> matching traces arrive within the window
    Then exactly one notification is sent at the end of the window
    And the notification body references all <count> traces

    Examples:
      | cadence              | count |
      | Every 5 minutes      | 3     |
      | Every 15 minutes     | 12    |
      | Every hour           | 50    |

  Scenario: Matches arriving after the window opens a new digest
    Given an automation with cadence "Every 5 minutes"
    And two matching traces arrive that get coalesced into one digest
    When a third matching trace arrives after the digest has been sent
    Then a new digest window opens for the third trace
    And the third trace is delivered in its own notification at the end of that window

  Scenario: Changing the cadence applies to future matches only
    Given an automation with cadence "Every hour"
    And matching traces are already queued inside the hour window
    When the user changes the cadence to "Immediate"
    Then in-flight matches still dispatch at the end of the original window
    And matches arriving after the change dispatch immediately

  Scenario: The same trace does not appear in two digests
    Given an automation with cadence "Every 5 minutes"
    When the same trace matches the filter twice within the window
    Then it appears once in the next digest
    And the per-(trigger, trace) dedup rule is preserved

  Scenario: Cadence does not affect dataset writes on a mixed-action automation
    Given a dataset automation and an email automation share the same filter
    When 10 matching traces arrive within 5 minutes
    Then all 10 rows are written to the dataset immediately
    And the email automation sends one digest at the end of the 5-minute window
