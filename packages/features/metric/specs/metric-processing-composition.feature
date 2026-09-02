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
    And it registers the same commands, projections and subscriber the App registers

  @unit
  Scenario: The append surface offers no read
    Given the port durable metric processing appends through
    When a caller looks for the usage-estimate query on it
    Then the port does not carry one

  @unit
  Scenario: The organization-wide usage read still routes by organization
    Given the full metric repository, composed with both clients
    When a usage estimate is asked for without naming a tenant
    Then the organization-keyed client answers it

  @unit
  Scenario: Both graphs append through one implementation
    Given the full metric repository and the append-only one
    When each is asked to store the same canonical point
    Then the same append path runs for both

  @unit
  Scenario: A worker without the Coding Agent pipeline names the missing edge
    Given a worker graph composed without the Coding Agent pipeline
    When the graph is composed
    Then the absence is reported by name
    And both pipelines are still mounted, because storage needs no other feature

  @unit
  Scenario: Producer and consumer clamp one lane count
    Given a lane count named in the environment
    When the worker composes durable metric and log processing
    Then the command lanes are spread over that many shards
