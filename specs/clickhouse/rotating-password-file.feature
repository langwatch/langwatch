Feature: The app logs in to ClickHouse with a password read from a file

  ADR-198 gives clickhouse-serverless rolling passwords: a user's password
  directory holds every valid password, and a rotation adds the new one before
  it removes the old. The app's client took its password from CLICKHOUSE_URL
  once, at boot, so a rotation meant a restart. With CLICKHOUSE_PASSWORD_FILE
  set, the client logs in as the URL's user with the password in that file,
  read again at most once a second, so a rotated Kubernetes Secret reaches
  the next statement without a restart. Unset, nothing changes.

  The file is one password, never a directory: the deployment chooses which of
  the user's valid passwords the app holds, and swaps it inside the overlap.

  @integration
  Scenario: Without a password file the client logs in with the URL's credentials
    Given CLICKHOUSE_URL names a user and a password
    And CLICKHOUSE_PASSWORD_FILE is not set
    When the app sends a statement to the shared ClickHouse
    Then the statement logs in with the URL's user and password

  @integration
  Scenario: With a password file every statement logs in with the file's password
    Given CLICKHOUSE_URL names a user and a stale password
    And CLICKHOUSE_PASSWORD_FILE names a file holding another password
    When the app sends a statement to the shared ClickHouse
    Then the statement logs in with the URL's user and the file's password

  @integration
  Scenario: A URL without a user logs in as default with the file's password
    Given CLICKHOUSE_URL names no user
    And CLICKHOUSE_PASSWORD_FILE names a file holding a password
    When the app sends a statement to the shared ClickHouse
    Then the statement logs in as default with the file's password

  @integration
  Scenario: The admin client logs in with the file's password too
    Given CLICKHOUSE_PASSWORD_FILE names a file holding a password
    When the untenanted admin client sends a statement
    Then the statement logs in with the URL's user and the file's password

  @integration
  Scenario: A rotated password reaches the next statement without a restart
    Given the app logs in with the password in CLICKHOUSE_PASSWORD_FILE
    When the file is replaced with a new password
    And a second has passed
    Then the next statement logs in with the new password

  @integration
  Scenario: A private route keeps its own credentials
    Given CLICKHOUSE_PASSWORD_FILE is set for the shared ClickHouse
    And an organization routes to its own ClickHouse with credentials in its URL
    When the app sends a statement for that organization
    Then the statement logs in with the private route's own credentials

  @unit
  Scenario: A password file that cannot be read at boot stops the process
    Given CLICKHOUSE_PASSWORD_FILE names a file that is missing, empty or a directory
    When the process builds its ClickHouse client
    Then the build fails with an error that names CLICKHOUSE_PASSWORD_FILE and the path
    And it never prints a password

  @unit
  Scenario: A password file that becomes unreadable keeps the last good password
    Given the app has read a password from CLICKHOUSE_PASSWORD_FILE
    When the file cannot be read at a later refresh
    Then the next statement logs in with the last good password
    And one warning names the path, never the password
    And the warning is not repeated until the file is readable again

  @unit
  Scenario: A blank CLICKHOUSE_PASSWORD_FILE is the same as unset
    Given CLICKHOUSE_PASSWORD_FILE is set to an empty value
    When the stores read their configuration
    Then no password file is configured
