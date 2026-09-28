Feature: Migrations wait for a ClickHouse that is still starting
  The app and the workers run the ClickHouse migrations at boot. On a fresh
  Helm install the chart-managed ClickHouse takes about a minute to accept
  connections, and until then every connection is refused. The migration step
  waits for the server instead of exiting, so a new install boots without a
  pod restart.

  @unit
  Scenario: A ClickHouse that starts accepting connections is waited for
    Given ClickHouse refuses connections for the first attempts
    When the migration step checks the server
    Then it retries until the server answers
    And it logs that it is waiting for ClickHouse, without the password

  @unit
  Scenario: A ClickHouse that never comes up fails after the wait
    Given ClickHouse refuses every connection
    When the configured wait passes
    Then the migration step fails naming the server and the wait setting

  @unit
  Scenario: A server that answers with an error is not retried
    Given ClickHouse answers the check with an authentication failure
    When the migration step checks the server
    Then it fails on the first attempt

  @unit
  Scenario: A zero wait fails on the first refused connection
    Given CLICKHOUSE_MIGRATE_WAIT_SECONDS is 0
    And ClickHouse refuses connections
    When the migration step checks the server
    Then it fails on the first attempt

  @unit
  Scenario: An unset wait setting uses the default
    Given CLICKHOUSE_MIGRATE_WAIT_SECONDS is not set
    When the wait is read
    Then it is 180 seconds

  @unit
  Scenario: Credentials in the ClickHouse URL never reach the log
    Given CLICKHOUSE_URL carries the user and password as query params
    When the migration step logs the server URL
    Then the logged URL has neither the user nor the password
