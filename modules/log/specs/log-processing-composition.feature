# See ../adrs/001-log-processing-boundary.md

Feature: Composing durable log processing

  Durable log processing is a queue consumer. It appends canonical records and
  reads nothing back.

  Its composition once asked for more: the repository behind the storage
  projection also carried a trace-scoped read and the row cap that bounds it.
  Trace serves that read from its own copy, so the read and its cap are gone and
  the append surface is all either graph composes.

  @unit
  Scenario: The processing pipeline composes from one tenant-keyed client
    Given a process that can route a tenant to its ClickHouse instance
    When it composes durable log processing
    Then the pipeline is built without a trace read cap
    And it registers the same command and projection the App registers

  @unit
  Scenario: Both graphs append through one implementation
    Given the full canonical-log repository and the append-only one
    When each is asked to store the same canonical record
    Then the same append path runs for both

  @integration
  Scenario: The api process serves every OTLP signal at its own module's door
    Given the api process installed over memory stores
    When an exporter posts a trace, a log and a metric batch without a key, canonically and under an alias
    Then each door answers main's credential refusal, and none answers not found
