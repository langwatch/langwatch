Feature: The daily insights run before a wider rollout
  What keeps daily runs cheap and tidy when many people have them on. A project that took no
  trace costs no model call. A schedule nobody can have any more turns itself off and says why:
  after 7 scheduled days whose run was skipped, when its person leaves the organisation, or
  when its project is archived. Every run leaves an audit line and is counted, and an operator
  can list every schedule.

  Background:
    Given the release_insights flag is on for the project

  Rule: A project that took no trace costs no model call

    @unit
    Scenario: A run on a project with no new traces asks Langy nothing
      Given a member with analytics:view, a board with widgets and a project that took no trace since the run's window began
      When the run is carried out
      Then it is recorded as nothing with the reason no_new_traces
      And Langy is never called and no insight is filed
      And the project was asked once for its newest trace since the window's start, leaving out Langy's

    # A run's own turn is traced into the project as Langy's; it is no reason to read the board again.
    @unit
    Scenario: A project whose only new traces are Langy's own asks Langy nothing
      Given a member with analytics:view, a board with widgets and a project whose only new traces are Langy's turns
      When the run is carried out
      Then it is recorded as nothing with the reason no_new_traces
      And Langy is never called

    @unit
    Scenario: A member without access is skipped before the project's traces are asked
      Given a member without analytics:view on a project that took no trace
      When a run is requested for them
      Then the run is recorded as skipped with the reason no_access
      And the project's traces are never asked

    @unit
    Scenario: A day with no new traces is no skipped day
      Given a schedule whose runs were skipped on 6 scheduled days in a row
      When the next day's run ends as nothing with the reason no_new_traces
      Then the count of skipped days starts over
      And it is still 6 after two more such days

    @unit
    Scenario: The last run line says when a project had no new traces
      Given a board that is on
      When its last run ended as nothing with the reason no_new_traces
      Then the line says there were no new traces, so Langy was not asked
      And a run where Langy found nothing still reads "nothing new"

  Rule: A schedule skipped on 7 scheduled days in a row turns itself off

    @unit
    Scenario: The skipped days are counted from the runs' outcomes
      Given scheduled runs that end skipped, skipped, filed and skipped, on four days
      When their outcomes are folded in order
      Then the count reads 1, then 2, then 0, then 1
      And a run that found nothing or failed starts the count over as a filed one does

    @unit
    Scenario: A run's outcome folded twice counts once
      Given a count of 3 skipped days
      When the newest run's outcome is folded again
      Then the count is still 3

    @unit
    Scenario: An outcome that arrives after a newer one changes nothing
      Given a count that already holds the run of a later day
      When the outcome of an earlier day's run arrives, skipped or filed
      Then the count is unchanged

    @unit
    Scenario: An operator's skipped run is no skipped day
      Given a count of 6 skipped days
      When an operator's run is skipped
      Then the count is still 6
      And an operator's run that files starts it over

    @unit
    Scenario: A skipped run on a From LangWatch board is no skipped day
      Given a count of 6 skipped days
      When a scheduled run is skipped with the reason template_board
      Then the count is still 6
      And it is still 6 after two more such days

    @unit
    Scenario: The seventh skipped day turns the schedule off
      Given a member who lost analytics:view, with their daily run on for a board
      When the run is skipped on 7 scheduled days in a row
      Then the schedule stays on through the sixth day
      And on the seventh the system turns it off with the reason skipped_days
      And no wake is armed, and the member reads off with that reason

    @unit
    Scenario: A run that files between skipped days starts the count over
      Given a schedule whose runs were skipped on 6 scheduled days in a row
      When the member has access again and the next day's run files
      Then the count of skipped days starts over
      And 6 more skipped days leave the schedule on

    @unit
    Scenario: Turning the daily run on again starts the count over
      Given a schedule the system turned off after 7 skipped days
      When the person turns it on again and the next run is skipped
      Then the schedule stays on
      And the person reads on with no reason

    @unit
    Scenario: A wake hands its run the skipped days before it
      Given a schedule whose last 3 scheduled runs were skipped
      When its slot comes due
      Then the run is handed 3 skipped days
      And a run that replaces one that never settled is handed none, as is an operator's run

    @unit
    Scenario: The row holds the skipped days beside why the schedule is off
      Given a person turned their daily run on
      When 2 scheduled runs are skipped, the system turns it off, and they turn it on again
      Then the row counts 1, then 2, then holds off with the reason, then on with no reason and a count of 0

    @unit
    Scenario: A process instance written before the skipped days were counted still reads
      Given a schedule's process instance stored without a count
      When it is read
      Then it holds no skipped day, and no off reached it

  Rule: A member who left and a project that was archived turn their schedules off

    @unit
    Scenario: A member removed from the organisation has their schedules turned off
      Given a member with daily runs on for two boards, and another member's on one of them
      When the member is removed from the organisation
      Then both of their schedules are turned off by the system with the reason member_removed
      And no wake is armed for either
      And the other member's schedule stays on

    @unit
    Scenario: Only the projects of the organisation the member left are asked
      Given a member removed from an organisation with two projects
      When their schedules are cleaned up
      Then each of the two projects is asked for that member's schedules that are on
      And no other project is

    @unit
    Scenario: An archived project has every schedule on its boards turned off
      Given two members with daily runs on in a project
      When the project is archived
      Then both schedules are turned off by the system with the reason project_archived
      And no wake is armed for either

    @unit
    Scenario: A clean-up fact delivered twice records one off
      Given a member with a daily run on
      When the same removal is handled twice
      Then one off is recorded for the schedule

    @unit
    Scenario: A schedule its person turned off keeps no reason after a clean-up
      Given a member who turned their daily run off
      When the member is removed from the organisation
      Then nothing more is recorded for the schedule
      And it reads off with no reason

    @unit
    Scenario: A schedule a clean-up turned off is not armed again by the reconcile pass
      Given a schedule a clean-up turned off
      When a reconcile pass runs
      Then nothing is asked of the schedule, and no wake is armed

    @unit
    Scenario: A request to arm that arrives after an off arms nothing
      Given a process instance that never took a setting, and an off that reached it
      When a reconcile pass's request to arm arrives, carrying the row's setting
      Then the schedule stays off and no wake is armed
      And the pass counts such an instance as settled

    @unit
    Scenario: The daily run pipeline hears who left and what was archived
      Given the daily run pipeline as the worker registers it
      When its subscribers on other modules' facts are read
      Then one is on the organisation's member removed fact and one on the project's archived fact

  Rule: Every run leaves an audit line and is counted

    @unit
    Scenario: A settled run writes one audit line for the person it acted for
      Given a run that filed two insights for a member on a board
      When its outcome is recorded
      Then the audit log holds one line for the project, naming the member as who the run acted for
      And the line names the schedule, the board, the outcome, the reason and the counts filed and renewed

    @unit
    Scenario: A run skipped before it started writes an audit line too
      Given a member without analytics:view
      When a run is requested for them
      Then the audit log holds one line with the outcome skipped and the reason no_access

    @unit
    Scenario: An outcome delivered twice writes one audit line
      Given a run's recorded outcome
      When the audit subscriber is handed it twice
      Then both writes carry the same key, an audit key stamped with the run's slot

    @unit
    Scenario: Each recorded outcome is counted by outcome and reason
      Given runs that end filed, skipped for no_access and failed for timeout
      When each is recorded
      Then insight_daily_run_total advances once for each pair of outcome and reason
      And a run with no reason is counted under the reason none

    @unit
    Scenario: A run's duration is recorded with its outcome
      Given a run that took 4 seconds
      When its outcome is recorded
      Then insight_daily_run_duration_milliseconds holds 4,000 for that outcome
      And a lost run recorded by the run that replaced it holds no duration

    @unit
    Scenario: The run metrics carry no project, person or board
      Given a recorded run
      When its metrics are written
      Then their only labels are outcome and reason

    @unit
    Scenario: A daily run records its metrics as it settles
      Given a daily run that is on, in a project that took no trace
      When the slot's run is carried out
      Then one run is counted as nothing with the reason no_new_traces, with a duration

  Rule: An operator lists every schedule

    @unit
    Scenario: The operator's list reads every project's schedules, the ones that are on first
      Given schedules that are on and off for two people, and a board a third never decided on
      When the operator's list is read
      Then it holds the schedules that are on, then the ones that are off, and never the undecided one
      And each names its project, its person, its board, its setting and how its last run ended

    @unit
    Scenario: The operator's list says why a schedule is off, its skipped days and its next run
      Given a schedule a clean-up turned off, and one that is on with 2 skipped days
      When the operator's list is read
      Then the first reads off with the reason and no next run
      And the second reads on with 2 skipped days and the slot its process has armed

    @unit
    Scenario: A schedule that lost its wake reads on with no next run
      Given a schedule that is on and whose wake was lost
      When the operator's list is read
      Then it reads on with no next run

    @integration
    Scenario: The operator's read of the rows is the same in both tiers
      Given rows that are on, off and undecided in two projects
      When the rows a person decided on are read, with a limit
      Then the ones that are on come first, then by id, cut to the limit, and none is undecided
      And a project's rows that are on are read for everyone, or for one person

    @integration
    Scenario: Why a schedule is off and its skipped days are stored with its row
      Given a row turned off by the system with a reason and a count of skipped days
      When its person reads their setting
      Then they read off with that reason

  Rule: Many schedules due inside one hour

    @unit
    Scenario: A thousand schedules due inside one hour each run once, spread over the hour
      Given 1,000 people turned their daily run on for the same hour
      When the hour passes, a minute at a time, and every wake is handled as it comes due
      Then each schedule started exactly one run, in its own minute
      And every minute of the hour started some and none started more than 40
      And a second pass over the same hour starts none

  Rule: The board's control says why the system turned a daily run off

    @unit
    Scenario: Each reason the system turns a daily run off for has its own words
      Given a daily run the system turned off
      When the reason is skipped_days, member_removed, project_archived or board_deleted
      Then each reads as one plain sentence, and skipped_days names the 7 days

    @integration
    Scenario: A board the system turned off says why and can be turned on again
      Given a board whose daily run the system turned off after 7 skipped days
      When the member opens the control in the board's header
      Then it says the run was turned off and why, and how the last run ended
      And turning it on from the control sends what they last chose

    @integration
    Scenario: A board its person turned off shows the quiet control and no reason
      Given a member turned a board's daily run off
      When they open the board
      Then the header shows the quiet switch and no notice
