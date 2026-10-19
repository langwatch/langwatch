Feature: Trace sends this month's trace ids to entitlement at upgrade
  As trace, the module that owns trace summaries
  I want my upgrade step to send each project's trace ids first seen this month
  So that entitlement counts a complete month from my events without asking me

  Ruling (Alex, 2026-10-11): trace usage is the number of distinct trace ids per project per month.
  Entitlement writes one row per trace and month, so the same trace sent twice is counted once.
  The step lists trace ids whose summary was first written (`trace_summaries.CreatedAt`) between
  the start of this UTC month and the moment the step started; live counting covers later traces,
  and any overlap is harmless. Nothing waits and nothing is stored by trace.

  @unit
  Scenario: The upgrade sends each project's trace ids for the month in pages
    Given projects with traces first seen this month, last month and after the step started
    When the upgrade step runs
    Then trace records one event per page of at most 5,000 trace ids for each project with traces
    And each event names the project, the month and only the traces first seen this month before the step started

  @unit
  Scenario: The upgrade saves its progress after every page of trace ids and every project
    When the upgrade step runs
    Then it saves the project and the last trace id after each page it sends
    And it saves the project as done once all its trace ids are sent

  @unit
  Scenario: A resumed upgrade continues inside the project it stopped in
    Given a saved checkpoint part-way through a project's trace ids
    When the upgrade step resumes
    Then it sends that project's trace ids after the saved one, then the projects after it
    And it keeps the month and the time window it started with

  @unit
  Scenario: A dry run of the upgrade sends and saves nothing
    When the upgrade step runs as a dry run
    Then no event is recorded and no checkpoint is saved
    And the report says how many trace ids and events a real run would send

  @unit
  Scenario: Re-running a finished upgrade sends nothing new
    Given a checkpoint saved after the last project
    When the upgrade step runs again from it
    Then no event is recorded

  @unit
  Scenario: The trace ids event is recorded in trace's own event log
    When trace records a page of a project's trace ids for a month
    Then one "month trace ids listed" event is appended for the project
