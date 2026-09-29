Feature: A finished simulation run tells nurturing, counted across the organization

  Every finished run — not only a connected agent's successful one — tells
  nurturing once, against the organization's admin, counted across every
  project the organization owns, this one included: main's
  customerIoSimulationSync, ported as a signal (§9).

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
