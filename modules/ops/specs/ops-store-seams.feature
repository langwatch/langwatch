Feature: Ops repositories hold only ops' own stores
  Ops' repositories take one store each; the calls to other modules sit in ops'
  services, which pass plain values to the repositories they hold.

  @unit
  Scenario: Process and scheduler operator acts are recorded through the audit log
    Given an operator wakes a process, redrives a fleet's dead letters and runs a schedule
    When ops' audit services record each act
    Then the audit log port receives each act with its target kind, target and metadata
    And a fleet-scoped act names the fleet rather than a made-up instance

  @unit
  Scenario: The operator trails list what ops' store holds, newest first
    Given process and scheduler acts held in ops' store
    When the trails are listed with a limit
    Then at most that many acts come back, newest first, and an empty trail answers empty

  @unit
  Scenario: A killed tenant's backlog is not counted by the rate tracker
    Given the anomaly kill switch is on for one tenant and off for another
    When the queue-metrics writer records each tenant's waiting jobs
    Then only the tenant whose switch is off is counted
    And a feature-flag lookup that fails counts the tenant rather than dropping it

  @unit
  Scenario: The checkup's ClickHouse ping is answered by ops' registry
    Given ops' memory registry
    When the checkup pings ClickHouse
    Then the ping answers without a raw ClickHouse client composed by the module
