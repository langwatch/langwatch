# See ../adrs/001-metric-processing-boundary.md

Feature: Composing durable metric processing

  Durable metric processing is a queue consumer. It appends canonical points,
  the series catalog and the 30-second rollups, and it reads nothing back.

  That is not what its composition asked for. The repository behind those three
  projections also carried the organization-wide usage estimate, and that read
  needs a ClickHouse client resolved from the ORGANIZATION — a routing decision
  the background worker cannot make and never has to, because nothing on the
  consuming path calls it. Demanding it anyway is what kept the pipeline
  buildable only inside the App, which is why the append surface is separated
  here rather than left implied by which methods happen to get called.

  @unit
  Scenario: The processing pipeline composes from one tenant-keyed client
    Given a process that can route a tenant to its ClickHouse instance
    When it composes durable metric processing
    Then the pipeline is built without an organization-keyed client
    And it registers the same commands and projections the App registers

  @unit
  Scenario: The metric capability is installed by the process that boots it
    Given a process that provides the data-privacy capability
    When it installs the metric feature and boots for the worker role
    Then the metric capability answers under its own name
    And an OTLP export request prepared through it is redacted before it is accepted

  @unit
  Scenario: Producer and consumer clamp one lane count
    Given a shard count named in configuration
    When the metric command lanes are computed
    Then the count is clamped to 1-128 and the lane is always bounded and non-empty
    And the commands registered on the real pipeline route through those lanes
