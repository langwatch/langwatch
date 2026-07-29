Feature: Seeing what your automations are doing
  As someone who has set up automations, alerts, and reports
  I want to see what runs on a schedule, what reacts to events, and what already happened
  So that I can trust they still work — without opening each one

  Background:
    Given an automation fires when something matches
    And an alert fires when a metric crosses a threshold
    And a report runs on a schedule

  Rule: I can see what is going to happen next

    # The next-run instant itself is computed and proven by `computeNextRunAt`,
    # but nothing renders AutomationTableCells, so what the PAGE shows for a
    # schedule — next run, last run, paused, never-run — is unproven end to end.

    @integration @unimplemented
    Scenario: A report shows when it next runs
      Given a report scheduled every Monday at 09:00
      When I look at the automations page
      Then it shows when the report next runs
      And it shows when it last ran

    @integration @unimplemented
    Scenario: A paused report shows no next run
      Given a report that is turned off
      When I look at the automations page
      Then it does not claim a next run time

    @integration @unimplemented
    Scenario: A report that has never run
      Given a report saved a moment ago that has not run yet
      When I look at the automations page
      Then it shows when it will first run
      And it says it has not run yet

  Rule: I can see what is reacting to events

    @integration @unimplemented
    Scenario: An alert that is currently breaching
      Given an alert whose metric is over its threshold
      When I look at the automations page
      Then the alert is shown as firing
      And it shows when it last fired

    # The trailing-30-day fire rollup behind this is proven in
    # `TriggerFireHistoryService`; the cell that renders it is not.
    @integration @unimplemented
    Scenario: An automation that matches traces
      Given an automation that has fired several times this month
      When I look at the automations page
      Then it shows when it last fired
      And it shows how often it fired recently

    @integration @unimplemented
    Scenario: An automation that has never fired
      Given a newly created automation
      When I look at the automations page
      Then it says it has not fired yet
      And this is not shown as a problem

  Rule: I can see what already happened

    @unit
    Scenario: Reviewing recent activity across everything
      Given automations, alerts, and reports that have all fired
      When I look at the history
      Then I see what happened, newest first
      And each entry names the automation and when it happened

    # Day headings are a render concern in AutomationsHistory, not part of
    # `toActivityEntries`, so nothing asserts them.
    @integration @unimplemented
    Scenario: Activity is grouped by day
      Given fires spanning several days
      When I look at the history
      Then entries are grouped under the day they happened

    @unit
    Scenario: History distinguishes what kind of thing happened
      Given an alert that started firing and later recovered
      And a report that was sent on schedule
      When I look at the history
      Then the alert's start and its recovery read differently
      And the report reads as having been sent

    @unit
    Scenario: An alert that is still open shows only when it started
      Given an alert that started firing and has not recovered
      When I look at the history
      Then only the moment it started is shown
      And no recovery is implied

    @unit
    Scenario: A fire outlives the automation that produced it
      Given a fire whose automation has since been deleted
      When I look at the history
      Then the fire is still shown
      And it is attributed to a deleted automation rather than dropped

    # Fire history is gated by a weaker permission than trace content is, so the
    # read itself must not be able to return trace fields at all.
    @unit
    Scenario: History never exposes trace content
      Given automations that fired on specific traces
      When I look at the history
      Then no trace ids or trace content are shown

    @integration @unimplemented
    Scenario: Nothing has happened yet
      Given a project whose automations have never fired
      When I look at the history
      Then it says nothing has fired yet
      And it does not show an empty table
