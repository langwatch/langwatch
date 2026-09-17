Feature: Live simulation updates

  @unit
  Scenario: Simulation updates release tenant listeners when the stream aborts
    Given a subscriber watching a project's simulation updates
    When a simulation update arrives
    Then the subscriber receives the original stream frame
    When the subscriber disconnects
    Then the project's event listener is released
