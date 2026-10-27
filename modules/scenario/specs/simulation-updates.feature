Feature: Live simulation updates

  @unit
  Scenario: Simulation updates release tenant listeners when the stream aborts
    Given a subscriber watching a project's simulation updates
    When a simulation update arrives
    Then the subscriber receives the original stream frame
    When the subscriber disconnects
    Then the project's event listener is released

  @unit
  Scenario: Every collaborator the scenario operations read is built at boot in the api and worker roles
    Given a process that boots the scenario feature over memory storage
    When it tests an agent, prefetches a run, hands a batch to an open tab, streams updates and reads the run history
    Then each operation answers or refuses by name, and none fails for a missing collaborator
