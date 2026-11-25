Feature: Scenario REST answers carry every field main publishes

  A client generated against main reads these fields off the scenario and
  simulation-run routes; an answer without them breaks that client.

  @unit
  Scenario: A simulation run answers with the scenario set and per-role figures it was recorded with
    Given a recorded run in scenario set "set-a" with per-role costs and latencies
    When the run is listed over the REST API
    Then the run carries its scenarioSetId, roleCosts and roleLatencies

  @unit
  Scenario: A scenario version is written at the snapshot shape that carries fields
    Given a scenario whose snapshot includes its field values
    When a version of it is written
    Then the version declares schema version 2
