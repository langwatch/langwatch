Feature: Integration tests against native local services
  As a developer who runs Postgres, ClickHouse, and Redis natively
  I want the integration suite to use those services instead of docker
  So that I can run integration tests without Docker Desktop eating my machine

  # Activated by LANGWATCH_TEST_CLICKHOUSE_URL + LANGWATCH_TEST_REDIS_URL
  # (optionally LANGWATCH_TEST_DATABASE_URL for Postgres) in langwatch/.env.
  # The mode is never active in CI, and testcontainers remains the default
  # when the variables are absent. These scenarios exercise the test harness
  # itself, so they are validated by running the suite, not by bound tests.

  @unimplemented
  Scenario: Native services replace testcontainers
    Given LANGWATCH_TEST_CLICKHOUSE_URL and LANGWATCH_TEST_REDIS_URL are set
    When I run the integration test suite
    Then no docker container is started
    And ClickHouse migrations run against the dedicated test database
    And Prisma migrations run against the dedicated Postgres test database

  @unimplemented
  Scenario: Test databases are isolated from dev data
    Given the native services also serve my dev stack
    When the integration suite runs and cleans up
    Then only the dedicated test databases are written or flushed
    And the dev redis database and dev Postgres database are untouched

  @unimplemented
  Scenario: A redis URL pointing at the dev database is rejected
    Given LANGWATCH_TEST_REDIS_URL selects redis database 0
    When I run the integration test suite
    Then the setup fails fast explaining a numbered test database is required

  @unimplemented
  Scenario: CI is unaffected
    Given the suite runs in CI
    Then CI service containers are used regardless of LANGWATCH_TEST_* variables
