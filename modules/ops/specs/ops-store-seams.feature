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
  Scenario: The operator trails list what the audit log holds, newest first
    Given process acts recorded through the audit log beside acts of another target kind
    When the trails are listed with a limit
    Then at most that many acts of the trail's own kind come back, newest first
    And an empty trail answers empty without asking user for any names

  @unit
  Scenario: A scheduler act names its actor by name, else by address
    Given scheduler acts by an account with a name and by one with only an address
    When the scheduler trail is listed
    Then user is asked once for the profiles of the distinct actors
    And each act names its actor by name, or by address when the account has no name

  @unit
  Scenario: A scheduler act by an account that is gone names no one
    Given a scheduler act whose actor's account no longer exists
    When the scheduler trail is listed
    Then the act is still listed and names no actor

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

  @unit
  Scenario: A replay run's engine is built by ops' registry over the registered pipelines
    Given ops' live registry over Redis, ClickHouse and the process's eventing member
    When a replay run asks for its engine with the retention ops' service resolved
    Then the engine rebuilds the projections the registered pipelines declare
    And closing the run releases its own Redis connection

  @unit
  Scenario: A memory process refuses a replay run rather than invent an event log
    Given ops' memory registry
    When a replay run asks for its engine
    Then the request is refused, as on a deployment that cannot serve a replay

  @unit
  Scenario: Introspection and the migration pass's private routes are read from ops' registry
    Given ops' registries over the process's eventing member
    When introspection lists the pipelines and the migration pass asks for private routes
    Then the pipelines are the ones eventing registered
    And the routes are the routed ClickHouse member's, or none in a memory process

  @unit
  Scenario: Ops boots over memory stores with only the eventing member beside them
    Given a process composed over memory stores and an eventing member
    When it boots ops in the api or the worker role
    Then ops installs and answers without any raw Postgres, Redis or ClickHouse client
