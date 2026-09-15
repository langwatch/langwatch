Feature: Composing the billable-events meter

  Every billable unit the platform sells — a span, a reported evaluation, an
  experiment result, a simulation message — is counted once, in one ClickHouse
  table, by a projection that spans every pipeline. A subscriber behind it asks
  the monthly roll-up to report what has accumulated.

  Only the App could build that pair. The projection's store wrote through the
  organization-keyed ClickHouse client the App owned, attribution went through
  a Redis cache private to the App, and the whole thing was gated on a
  deployment fact only the App's configuration carried. Stating all three in
  the feature is what lets the process that consumes the queue compose them.

  Both graphs answer "which organization is this project billed to" out of one
  Redis keyspace, and the answer cannot go stale: a project belongs to a team
  and a team to an organization, and neither link is reassignable.

  @unit
  Scenario: A billable event is counted against the organization it belongs to
    Given a composed billable-events meter
    When a billable event is recorded
    Then the row is written through the ClickHouse client that organization routes to
    And it carries the organization the event's project belongs to

  @unit
  Scenario: Both graphs attribute a project from one shared keyspace
    Given a composed billable-events meter
    When it attributes a project for the first time
    Then it reads and writes the keyspace the App also reads
    And a second event for the same project asks the database nothing

  @unit
  Scenario: An orphan project is skipped rather than billed to a neighbour
    Given a project that belongs to no organization
    When a billable event for it is recorded
    Then no billable row is written
    And no usage report is dispatched

  @unit
  Scenario: The meter and its dispatch subscriber keep the names both graphs route
    Given a composed billable-events meter and its dispatch subscriber
    When their registration names and deduplication identity are read
    Then they are the names and the identity the App's own pair declares

  @unit
  Scenario: A late-arriving month is reported inside the grace window
    Given a dispatch subscriber running in the first days of a month
    When a billable event is recorded
    Then usage is reported for the previous month as well as the current one
    And a run outside that window reports the current month only

  @unit
  Scenario: A worker mounts the meter only where the deployment is SaaS
    Given a background worker composing its own graph
    When it reads the same deployment variable the App reads
    Then a SaaS process routes both of the meter pair's shared-queue jobs
    And a self-hosted process routes neither

  @unit
  Scenario: A worker routes the meter by organization, not by tenant
    Given a worker composing the meter over its own tenant-keyed ClickHouse client
    When a billable event for a private-instance customer is recorded
    Then the client is resolved for the organization the project belongs to
    And it is never resolved for the project itself

  @unit
  Scenario: A SaaS worker refuses to meter without a pipeline to report through
    Given a SaaS worker composed with no billing reporting pipeline
    When the graph is composed
    Then composition fails and names the pipeline the reports are sent through
