Feature: A saved report is scheduled the moment it is saved
  As a team that put a report on a schedule
  I want the schedule to take effect when I save it
  So that the first send arrives when the schedule says, and the page tells me the truth about when that is

  Background:
    Given a report is an automation that sends on a schedule
    And the process a member saves a report on is not the process that sends it
    And both processes read one shared schedule

  Rule: Saving a report schedules it

    @integration
    Scenario: Saving a report schedules it for its next send
      Given an author saves a report that sends every Monday at 09:00
      Then the report's next send is the coming Monday at 09:00
      And the process that sends reports finds it on the schedule

    @integration
    Scenario: A saved report starts counting without waiting for a restart
      When an author saves a report
      Then the process that sends reports is told straight away
      And the report does not wait for that process to be restarted before it counts

    @integration
    Scenario: Changing a report's cadence moves its next send
      Given a report that sends every Monday at 09:00
      When the author changes it to send every Friday at 17:00
      Then the report's next send is the coming Friday at 17:00
      And the report is not also still scheduled for Monday

  Rule: A report that must not send is off the schedule

    @integration
    Scenario: Pausing a report takes it off the schedule
      Given a report that sends every Monday at 09:00
      When the author pauses it
      Then the report has no next send
      And the process that sends reports does not send it

    @integration
    Scenario: Resuming a report puts it back on the schedule
      Given a report the author paused
      When the author resumes it
      Then the report's next send is the coming Monday at 09:00
      And it is the same schedule entry it had before, not a second one

    @integration
    Scenario: Deleting a report takes it off the schedule
      Given a report that sends every Monday at 09:00
      When the author deletes it
      Then the report has no next send

  Rule: The automations page reports the schedule that will actually run

    @integration
    Scenario: The automations page shows the next send that will actually happen
      Given an author saves a report that sends every Monday at 09:00
      When the automations page lists what is scheduled
      Then it names the report and its coming Monday send
      And the time it names is the one the sending process will act on
