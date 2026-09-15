# See ../adrs/001-log-processing-boundary.md

Feature: Composing durable log processing

  Durable log processing is a queue consumer. It appends canonical records and
  reads nothing back.

  Its composition asked for more: the repository behind the storage projection
  also carried the trace-scoped read and the row cap that bounds it. A process
  handed a read cap it never consults is a process whose composition says
  something untrue about what it does, so the append surface is separated here
  rather than left implied by which methods happen to get called.

  @unit
  Scenario: The processing pipeline composes from one tenant-keyed client
    Given a process that can route a tenant to its ClickHouse instance
    When it composes durable log processing
    Then the pipeline is built without a trace read cap
    And it registers the same command, projection and subscriber the App registers

  @unit
  Scenario: The append surface offers no read
    Given the port durable log processing appends through
    When a caller looks for the trace-scoped read on it
    Then the port does not carry one

  @unit
  Scenario: Both graphs append through one implementation
    Given the full canonical-log repository and the append-only one
    When each is asked to store the same canonical record
    Then the same append path runs for both

  @unit
  Scenario: The ADR-056 edge is mounted rather than declared missing
    Given a worker graph composed from its own substrate
    When the graph is composed
    Then the pipeline mounts its coding-agent dispatch subscriber
    And nothing is reported at boot about a missing Coding Agent pipeline
