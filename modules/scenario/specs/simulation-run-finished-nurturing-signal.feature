Feature: A finished simulation run tells nurturing, counted across the organization

  A finished run tells nurturing against the organization's admin, counted
  across every project the organization owns, this one included: main's
  customerIoSimulationSync, ported as a signal (§9). A project's first finished
  run is told at once, so the organization's first run still reaches nurturing
  with a count of one; later runs within five minutes of it are not told, and
  the next run after the window carries a count that includes them (main's
  debounce). The count is one read across the organization's projects, which
  share one ClickHouse route; a read per project on every run saturated
  ClickHouse and starved trace ingestion.

  @unit
  Scenario: A finished run tells nurturing the organization's run count so far
    Given a simulation run finished in a project with an organization admin
    When its finished event is handled
    Then nurturing receives simulation_run_finished against the admin with the organization's run count

  @unit
  Scenario: A finished run in a project with no organization admin tells nurturing nothing
    Given a simulation run finished in a project that resolves no organization admin
    When its finished event is handled
    Then nurturing receives nothing

  @unit
  Scenario: The organization's run count is read once per sync, not once per project
    Given an organization with three projects
    When a finished run in one of them is handled
    Then the run count is asked for once, naming all three projects

  @unit
  Scenario: Finished runs in one project tell nurturing at most once per five-minute window
    Given the simulation-run-finished nurturing subscriber
    When two runs finish in one project and one in another
    Then the first run in each project is told at once
    And a later run in the same project within five minutes is squashed into the first
    And the other project keeps its own lane and its own window
