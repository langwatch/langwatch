Feature: Trace records each trace's first sighting for entitlement's count
  As trace, the module that owns trace summaries
  I want to record each trace once when I first see it, and each project's month once at upgrade
  So that entitlement counts traces from my facts without ever asking me

  Ruling (Alex, 2026-10-11): entitlement's trace meter is a count per project and month, fed by
  facts. First seen means the trace summary's first write (`trace_summaries.CreatedAt`), so a trace
  that started before the 1st but first reached us this month counts this month, and one first seen
  last month does not count again. Cut (Alex, 2026-10-11): the moment the old writers are gone,
  kept exactly. The upgrade counts up to the first whole UTC minute at or after it; entitlement keeps
  sightings by minute until the seed lands, so it drops the ones the seed counted.

  @unit
  Scenario: Each trace is recorded as first seen once, at its summary's first write
    Given a trace whose first spans fold into a new summary
    When the summary is first written
    Then trace records one "trace first seen" fact for the project at the summary's first write
    And the spans of that first batch share one job

  @unit
  Scenario: A span arriving after the trace was first seen records nothing
    Given a trace whose summary was already written
    When a later span folds into it
    Then no first-seen fact is recorded

  @unit
  Scenario: A re-sent fact is stored once
    Given a first sighting keyed by project, trace and month, and a month's count keyed by project and month
    When either is recorded again
    Then trace's log keeps one of each

  @unit
  Scenario: The upgrade counts a trace in the month it was first seen
    Given a project with traces first seen last month, this month and after the cut
    When the upgrade counts the project's month
    Then only traces whose earliest summary write is this month and before the cut are counted

  @unit
  Scenario: The upgrade records one count per project for the month before its cut
    Given projects with and without traces first seen this month
    When the upgrade step runs
    Then each project with traces gets one "traces counted before cut" fact for the month
    And a project with none gets no fact

  @unit
  Scenario: The count's cut is the moment the old writers are gone, kept exactly
    Given the step needs the old writers gone, so every worker records first sightings
    When it starts at 14:20:30
    Then its cut is 14:20:30, it counts traces first seen before 14:21
    And it waits only until that minute has settled, about a minute

  @unit
  Scenario: The upgrade pages projects and saves its cut and each page it completes
    Given more projects than one page
    When the upgrade step runs
    Then it saves its cut before waiting for it
    And it saves the last project of each page it completes

  @unit
  Scenario: A resumed upgrade keeps its cut and continues after the saved page
    Given an upgrade step stopped after saving a page
    When it runs again from that checkpoint
    Then it counts against the saved cut, from the project after the saved one

  @unit
  Scenario: A dry run of the upgrade records and saves nothing
    When the upgrade step runs as a dry run
    Then it reports the projects and traces counted so far
    And it records no fact, saves no checkpoint and does not wait for the cut
