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

  # --- LangWatchQL's server without the system credential -------------------

  @unit
  Scenario: A process without CLICKHOUSE_URL takes the LangWatchQL server from the reader's URL and sends nothing
    Given a process given the reader and the writer and no CLICKHOUSE_URL
    When its stores open
    Then the LangWatchQL server is the reader URL's origin and database, without its user or password
    And it holds no statements to send to that server

  @unit
  Scenario: A process given neither CLICKHOUSE_URL nor a reader URL with a database names no LangWatchQL server
    Given a process given a reader URL with no database in its path and no CLICKHOUSE_URL
    When its stores open
    Then no LangWatchQL server is named

  # --- The chart --------------------------------------------------------------

  @unit
  Scenario: The chart gives the api no system credential once the reader and the writer are on
    Given a chart install with clickhouse.appReader.enabled and clickhouse.appWriter.enabled
    When the chart renders
    Then the app container has no CLICKHOUSE_URL, CLICKHOUSE_PASSWORD or CLICKHOUSE_PASSWORD_FILE
    And it still has CLICKHOUSE_READER_URL and CLICKHOUSE_WRITER_URL
    And the workers, the worker sidecar and the access-render Job keep CLICKHOUSE_URL

  @unit
  Scenario: The api's own extra env cannot hand it the system credential back
    Given the reader and the writer are on
    And app.extraEnvs sets CLICKHOUSE_URL, CLICKHOUSE_PASSWORD_FILE and a CLICKHOUSE_URL__<label>__<orgId> route
    When the chart renders
    Then the app container has none of them
    And the workers keep each one

  @unit
  Scenario: With the reader or the writer off the chart gives the api what it gave before
    Given a chart install with the reader on and the writer off
    When the chart renders
    Then the app container's env is unchanged, CLICKHOUSE_URL included
