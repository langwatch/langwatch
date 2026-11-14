Feature: The api process holds no ClickHouse credential that reads every tenant
  The api reads as the app reader and inserts as the insert-only writer; only the worker and
  the tasks hold the system credential (ADR-202 Decided 3, 12 and 14). Self-hosted installs run
  one release in shadow (Decided 4), so an api still given the system credential beside the
  reader and the writer boots and warns by variable name rather than refusing to start.
  ADR: dev/docs/adr/202-clickhouse-row-policies-enforce-tenancy-for-every-read.md

  @unit
  Scenario: An api on the reader and the writer alone serves both route families
    Given an api process given the reader and the writer for the shared server and for an organisation's own server
    And no system ClickHouse credential
    When it reads and inserts for a project on the shared server and for a project of that organisation
    Then each read reaches its server as the reader and each insert as the writer
    And no statement is sent as the system user

  @unit
  Scenario: An api given the system credential beside the reader and the writer warns by variable name
    Given an api process given the reader, the writer and CLICKHOUSE_URL
    When its stores open
    Then it boots
    And it logs one warning naming CLICKHOUSE_URL as a credential the api must not hold
    And the warning never carries the credential's value

  @unit
  Scenario: The warning names every system route and the password file, never their values
    Given an api process given the reader and the writer
    And a CLICKHOUSE_URL__<label>__<orgId> route, a malformed one and CLICKHOUSE_PASSWORD_FILE
    When its stores open
    Then the warning names each route variable and CLICKHOUSE_PASSWORD_FILE
    And no URL, user or password appears in it

  @unit
  Scenario: A worker or tasks process holding all three credentials does not warn
    Given a worker process and a tasks process each given the reader, the writer and CLICKHOUSE_URL
    When their stores open
    Then neither logs the api credential warning

  @unit
  Scenario: An api without both the reader and the writer keeps today's behaviour and does not warn
    Given an api process given CLICKHOUSE_URL and the reader, but no writer
    When its stores open
    Then it does not log the api credential warning
