Feature: Private ClickHouse Routing

  Enterprise customers can have a dedicated ClickHouse instance for data
  isolation. The app routes reads and writes to the correct instance based
  on the organization that owns the project.

  Credentials come from environment variables, not the database. The env var
  format is: CLICKHOUSE_URL__<label>__<orgId>=<connectionUrl>
  where <label> is a human-readable customer name (ignored by code) and
  <orgId> is the organization ID used for routing.

  Background:
    Given a shared ClickHouse instance configured via CLICKHOUSE_URL
    And a private ClickHouse instance configured via CLICKHOUSE_URL__acme__org123

  # ---------------------------------------------------------------------------
  # Env var parsing
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Parse private ClickHouse URL from env var
    Given env var "CLICKHOUSE_URL__acme__org123" is set to "http://private-ch:8123/langwatch"
    When the private ClickHouse config is loaded at startup
    Then org "org123" maps to connection URL "http://private-ch:8123/langwatch"
    And the label "acme" is ignored by the routing logic

  @unit
  Scenario: Multiple private ClickHouse env vars are parsed
    Given env var "CLICKHOUSE_URL__acme__org1" is set to "http://ch1:8123/langwatch"
    And env var "CLICKHOUSE_URL__beta__org2" is set to "http://ch2:8123/langwatch"
    When the private ClickHouse config is loaded at startup
    Then org "org1" maps to "http://ch1:8123/langwatch"
    And org "org2" maps to "http://ch2:8123/langwatch"

  @unit
  Scenario: No private ClickHouse env vars results in empty map
    Given no env vars matching "CLICKHOUSE_URL__*__*" are set
    When the private ClickHouse config is loaded at startup
    Then the private ClickHouse map is empty

  # ---------------------------------------------------------------------------
  # Organization-level routing
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Org with private ClickHouse gets a dedicated client
    Given org "org123" has a private ClickHouse URL configured via env var
    When getClickHouseClientForOrganization("org123") is called
    Then the returned client connects to the private ClickHouse URL
    And no database query is made for credentials

  @unit
  Scenario: Org without private ClickHouse gets the shared client
    Given org "org456" has no private ClickHouse env var
    When getClickHouseClientForOrganization("org456") is called
    Then the returned client connects to the shared ClickHouse from CLICKHOUSE_URL

  @unit
  Scenario: Private clients are cached per organization
    When getClickHouseClientForOrganization("org123") is called twice
    Then the same client instance is returned both times

  # ---------------------------------------------------------------------------
  # Project-level routing
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Project in a private-CH org routes to the private instance
    Given org "org123" has a private ClickHouse configured
    And a project exists under org "org123"
    When getClickHouseClientForProject(projectId) is called
    Then the returned client connects to the private ClickHouse

  @integration
  Scenario: Project in a standard org routes to the shared instance
    Given org "org456" has no private ClickHouse configured
    And a project exists under org "org456"
    When getClickHouseClientForProject(projectId) is called
    Then the returned client connects to the shared ClickHouse

  # ---------------------------------------------------------------------------
  # Admin / migration operations
  # ---------------------------------------------------------------------------

  @unit
  Scenario: getAllClickHouseInstances returns shared and all private instances
    Given the shared ClickHouse is configured
    And 2 private ClickHouse instances are configured via env vars
    When getAllClickHouseInstances() is called
    Then it returns 3 instances total
    And one has target "shared"
    And two have target set to their respective org IDs

  # ---------------------------------------------------------------------------
  # Data isolation proof
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Data written for a private-CH org does not appear in shared
    Given org "org123" has a private ClickHouse (container A)
    And the shared ClickHouse is container B
    And a project exists under org "org123"
    When a row is inserted via the routed client for this project
    Then the row exists in container A
    And the row does NOT exist in container B

  @integration
  Scenario: Data written for a standard org does not appear in private
    Given org "org456" uses the shared ClickHouse (container B)
    And org "org123" has a private ClickHouse (container A)
    And a project exists under org "org456"
    When a row is inserted via the routed client for this project
    Then the row exists in container B
    And the row does NOT exist in container A
