Feature: The ops ClickHouse client logs in with a password read from a file

  The operator EXPLAIN endpoint runs as its own ClickHouse user, named by
  CLICKHOUSE_OPS_URL. That client took its password from the URL once, so a
  rotation meant a restart. With CLICKHOUSE_OPS_PASSWORD_FILE set, it logs in
  as the URL's user with the password in that file, read again at most once a
  second through the same reader as CLICKHOUSE_PASSWORD_FILE
  (specs/clickhouse/rotating-password-file.feature). Unset, nothing changes.

  @integration
  Scenario: Without an ops password file the ops client logs in with the URL's credentials
    Given CLICKHOUSE_OPS_URL names a user and a password
    And CLICKHOUSE_OPS_PASSWORD_FILE is not set
    When the ops client sends an EXPLAIN statement
    Then the statement logs in with the URL's user and password

  @integration
  Scenario: With an ops password file the ops client logs in with the file's password
    Given CLICKHOUSE_OPS_URL names a user and a stale password
    And CLICKHOUSE_OPS_PASSWORD_FILE names a file holding another password
    When the ops client sends an EXPLAIN statement
    Then the statement logs in with the URL's user and the file's password

  @integration
  Scenario: A rotated ops password reaches the next EXPLAIN without a restart
    Given the ops client logs in with the password in CLICKHOUSE_OPS_PASSWORD_FILE
    When the file is replaced with a new password
    And a second has passed
    Then the next EXPLAIN statement logs in with the new password

  @unit
  Scenario: An ops password file that cannot be read at boot stops the process
    Given CLICKHOUSE_OPS_URL is set
    And CLICKHOUSE_OPS_PASSWORD_FILE names a file that is missing, empty or a directory
    When the ops process builds its ClickHouse client
    Then the build fails with an error that names CLICKHOUSE_OPS_PASSWORD_FILE and the path
    And it never prints a password

  @unit
  Scenario: A blank CLICKHOUSE_OPS_PASSWORD_FILE is the same as unset
    Given CLICKHOUSE_OPS_PASSWORD_FILE is set to an empty value
    When the ops module reads its configuration
    Then no ops password file is configured
