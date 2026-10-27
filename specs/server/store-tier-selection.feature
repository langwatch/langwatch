Feature: Store tier selects module repositories
  The process chooses one store tier for every installed module.

  @unit
  Scenario: Memory stores select repository twins for every process role
    Given a module declares live Redis and memory repository implementations
    When the API or worker supplies memory stores
    Then its operation uses the memory repository without opening Redis
    And modules without repositories still install

  @unit
  Scenario: Live stores continue selecting live repositories
    Given a module declares live and memory repository implementations
    When the process supplies a live store source
    Then its operation uses the live repository
