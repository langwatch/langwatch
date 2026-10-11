Feature: Trace counts each project's traces for entitlement
  As trace, the module that owns trace summaries
  I want to send one event per new trace, and count each project's month once at upgrade
  So that entitlement counts traces from my events without ever asking me

  Ruling (Alex, 2026-10-11): entitlement's trace meter is a count per project and month, built from
  trace's events. First seen means the trace summary's first write (`trace_summaries.CreatedAt`), so
  a trace that started before the 1st but first reached us this month counts this month, and one
  first seen last month does not count again. The upgrade stores the moment it counts up to before
  it counts. The new-trace subscriber sends nothing while no moment is stored, and afterwards only
  for traces first seen at or after it. Traces before the moment are in the count, traces after it
  arrive as events, so entitlement only adds the two.

  @unit
  Scenario: Each trace is recorded as first seen once, at its summary's first write
    Given a trace whose first spans fold into a new summary, after the upgrade's moment
    When the summary is first written
    Then trace sends one "trace first seen" event for the project at the summary's first write
    And the spans of that first batch share one job

  @unit
  Scenario: A span arriving after the trace was first seen records nothing
    Given a trace whose summary was already written
    When a later span folds into it
    Then no new-trace event is sent

  @unit
  Scenario: Before the upgrade stores its moment, no new-trace event is sent
    Given the upgrade has not stored the moment it counts up to
    When a new trace is first seen
    Then no event is sent, since the upgrade's count will hold it

  @unit
  Scenario: A trace first seen before the stored moment is left to the count
    Given the upgrade has stored its moment
    When a trace first seen before it is handled late
    Then no event is sent, and a trace first seen at the moment sends one

  @unit
  Scenario: The stored moment is read once it exists, and re-read until then
    Given the subscriber reads the stored moment
    When nothing is stored yet
    Then it reads again on the next trace
    And once a moment is found it is kept without reading again

  @unit
  Scenario: A re-sent event is stored once
    Given a new-trace event keyed by tenant and trace id, and a month's count keyed by project and month
    When either is recorded again
    Then trace's log keeps one of each

  @unit
  Scenario: The upgrade counts a trace in the month it was first seen
    Given a project with traces first seen last month, this month and after the moment
    When the upgrade counts the project's month
    Then only traces whose earliest summary write is this month and before the moment are counted

  @unit
  Scenario: The upgrade records one count per project for the month
    Given projects with and without traces first seen this month
    When the upgrade step runs
    Then each project with traces gets one "month traces counted" event
    And a project with none gets no event

  @unit
  Scenario: The upgrade stores the moment it counts up to before it counts
    Given the step needs the old writers gone, so every worker sends new-trace events
    When it starts at 14:20:30
    Then it stores 14:21:30 as the moment before counting anything
    And it counts once that moment has passed and settled, within about three minutes of starting

  @unit
  Scenario: A re-run of the upgrade keeps the moment already stored
    Given a moment stored by an earlier run
    When the step runs again with no checkpoint
    Then it counts up to the stored moment and stores no other

  @unit
  Scenario: The upgrade pages projects and saves its moment and each page it completes
    Given more projects than one page
    When the upgrade step runs
    Then it saves its moment before waiting for it
    And it saves the last project of each page it completes

  @unit
  Scenario: A resumed upgrade keeps its moment and continues after the saved page
    Given an upgrade step stopped after saving a page
    When it runs again from that checkpoint
    Then it counts up to the saved moment, from the project after the saved one

  @unit
  Scenario: A dry run of the upgrade records, stores and saves nothing
    When the upgrade step runs as a dry run
    Then it reports the projects and traces counted so far
    And it records no event, stores no moment, saves no checkpoint and does not wait
