Feature: The operator's list of daily insight schedules
  An operator reads every person's daily insights schedule on the Schedules page, beside the
  report schedules: the project, the board, the owner, whether it is on and why not, when it
  next runs, how the last run ended and how many scheduled days in a row were skipped. The list
  is read only. A schedule is its person's own setting, and the insight module owns every write.

  Rule: The list is insight's own read, named for an operator

    @unit
    Scenario: The list names each schedule's project and owner beside its own facts
      Given a daily insights schedule that is on, in a project and for a person that both exist
      When the operator's list is read
      Then the schedule is listed with the project's name and the owner's name
      And with its board, its hour and zone, its next run, its last run's outcome and reason, and its skipped days

    @unit
    Scenario: A schedule that is off is listed with why, and with no next run
      Given a daily insights schedule the system turned off after skipped days
      When the operator's list is read
      Then it is listed as off with that reason and no next run

    @unit
    Scenario: A project or an owner that is gone is listed by its id
      Given a schedule whose project and owner no longer exist
      When the operator's list is read
      Then the schedule is listed with no project name and no owner name
      And its project id and user id are kept

    @unit
    Scenario: The list is bounded
      Given a caller that asks for no limit, for none, for 5,000 and for 25
      When the operator's list is read
      Then insight is asked for 200, 1, 500 and 25

    @unit
    Scenario: The list is a read behind the operator's view permission
      Given the ops procedures as they are declared
      When the daily insight schedules procedure is read
      Then it is a query at the platform tier that asks ops:view

  Rule: The Schedules page shows the list under the report schedules

    @integration
    Scenario: The Schedules page lists each daily insights schedule
      Given a schedule that is on, one the system turned off and one its person turned off
      When the operator opens the list
      Then each row names the project, the board and the owner
      And says whether it is on, off, or turned off and why
      And shows the next run, how the last run ended and why, and the skipped days out of 7

    @integration
    Scenario: A schedule that is on with no next run is marked
      Given a schedule that is on and has no wake armed
      When the operator opens the list
      Then its next run reads as not armed

    @integration
    Scenario: An empty list says nobody turned daily insights on
      Given no daily insights schedule
      When the operator opens the list
      Then it says nobody has turned daily insights on yet

    @unit
    Scenario: The schedules that need a look come first
      Given schedules that are on, on with no wake armed, close to turning themselves off, and off
      When they are ordered for the operator
      Then the one with no wake armed comes first, then the one close to turning off, then the rest that are on, then the ones that are off
