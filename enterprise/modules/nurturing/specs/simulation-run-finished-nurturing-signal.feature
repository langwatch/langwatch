Feature: A finished simulation run tells nurturing, counted across the organization

  Scenario records its finished runs; nurturing reacts as a peer subscriber and
  keeps the organization's run count itself (§9), so no read crosses projects.
  The organization's first counted run is flagged `first`; Customer.io's
  delivery debounce stands in for main's five-minute window.

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
