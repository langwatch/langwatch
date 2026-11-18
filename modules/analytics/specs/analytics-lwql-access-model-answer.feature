Feature: The worker answers whether LangWatchQL's access model is provisioned; the api only reads it

  Whether the LangWatchQL server holds an access model is read from system.users,
  system.settings_profiles and system.row_policies, which only the system credential reads.
  The api holds no system credential (ADR-202 Decided 3 and 14), so the worker probes on its
  own identity at every reconvergence check and stores the answer per LangWatchQL server.
  Every LangWatchQL run's placement gate reads that answer and never probes, in any role.
  ADR: dev/docs/adr/202-clickhouse-row-policies-enforce-tenancy-for-every-read.md

  @unit
  Scenario: Each reconvergence check stores the access model's answer for its server
    Given a worker whose LangWatchQL server holds a provisioned access model
    When the reconvergence check runs
    Then the answer "provisioned" is stored for that server's origin
    And a LangWatchQL run is then answered without a probe

  @unit
  Scenario: A check that provisions the access model stores the new answer before it ends
    Given a worker whose LangWatchQL server holds no access model, in SQL mode
    When the reconvergence check provisions it
    Then the answer stored for that server is "provisioned" once the check ends

  @unit
  Scenario: A run before any worker has answered is refused as not provisioned yet
    Given no answer is stored for the LangWatchQL server
    When a LangWatchQL query runs
    Then it is refused with error code lwql_not_provisioned
    And the refusal is logged as not provisioned yet
    And no probe runs and the executor is never called

  @unit
  Scenario: The placement gate never probes, even in a process holding the system credential
    Given a process whose access model probe would answer "provisioned"
    And no answer is stored for the LangWatchQL server
    When a LangWatchQL query runs
    Then the probe is never called

  @unit
  Scenario: A probe that fails stores nothing and the check still completes
    Given a worker whose access model probe fails
    When the reconvergence check runs
    Then no answer is stored
    And the check completes and logs a warning

  @unit
  Scenario: A store that refuses the answer does not fail the check
    Given a worker whose answer store refuses the write
    When the reconvergence check runs
    Then the check completes and logs a warning

  @unit
  Scenario: A stored answer outlives the gap between two checks
    Given the worker stored an answer at one check
    When a LangWatchQL query runs one check interval later, before the next check has stored one
    Then the stored answer still decides it

  @unit
  Scenario: A process that names no LangWatchQL server, or holds no identity to probe with, stores nothing
    Given a process whose config names no server to hold the access model, or names one without the system credential
    When the answer is refreshed
    Then nothing is probed and nothing is stored
