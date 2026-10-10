Feature: A cron schedule reads as a sentence with its expression beside it
  As someone scanning scheduled reports
  I want each schedule said in words with the cron expression still visible
  So that I know when it runs without decoding the expression

  @integration
  Scenario: Common schedules read as sentences
    Given the schedules "*/15 * * * *", "0 9 * * 1" and "30 8 * * 1-5"
    Then they read "Every 15 minutes", "Every Monday at 09:00" and "Weekdays at 08:30"

  @integration
  Scenario: A schedule it cannot say reads as custom
    Given the schedule "0 9 1-7 1,7 *"
    Then it reads "Custom schedule" and still shows the expression

  @integration
  Scenario: Each field of the expression names itself
    Given the schedule "*/15 * * * *" in "Europe/Amsterdam"
    Then the expression shows five segments: minute, hour, day of month, month and day of week
    And the minute segment means "every 15 minutes"
    And the timezone reads "Amsterdam"
