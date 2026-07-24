Feature: Local-dev override of the platform retention default
  As a developer running LangWatch locally
  I want an unseeded dev stack to keep only a little data by default
  So that ClickHouse stays small without touching per-tenant retention

  # The platform retention default (49 days / 7 weeks) is what a tenant's data
  # is stamped with when no override exists anywhere in its scope cascade (see
  # data-retention/ingestion-stamping.feature and retention-policy-configuration
  # .feature). That default is fixed in production, but a local stack can lower
  # it through the LANGWATCH_DEFAULT_RETENTION_DAYS environment variable so an
  # unseeded worktree keeps a week of data instead of seven. haven pins it to 7
  # for every dev stack (LANGWATCH_DEFAULT_RETENTION_DAYS in .env.portless).
  #
  # This is strictly a local-dev affordance. Lowering the default in production
  # would silently expire customer data, so the control plane FAILS LOUD at
  # start-up if the variable is ever set while NODE_ENV=production. And because
  # every retention-managed table is partitioned weekly (toYearWeek), the value
  # must be a whole number of weeks, or start-up fails loud too.

  @unit
  Scenario: An unset variable resolves to the fixed platform default
    Given LANGWATCH_DEFAULT_RETENTION_DAYS is not set
    When the platform retention default is resolved
    Then it is 49 days

  @unit
  Scenario: A dev stack lowers the default to a week
    Given NODE_ENV is not production
    And LANGWATCH_DEFAULT_RETENTION_DAYS is 7
    When the platform retention default is resolved
    Then it is 7 days

  @unit
  Scenario: haven pins the seven-day default for every dev stack
    Given haven brings up a worktree's stack
    When it writes the stack's environment overlay
    Then LANGWATCH_DEFAULT_RETENTION_DAYS is 7
    And the value is a whole number of weeks

  @unit
  Scenario: Setting the override in production fails loud
    Given NODE_ENV is production
    And LANGWATCH_DEFAULT_RETENTION_DAYS is 7
    When the platform retention default is resolved
    Then start-up fails with an error naming the variable
    And the error explains the default must not be lowered in production

  @unit
  Scenario: A default that is not a whole number of weeks fails loud
    Given NODE_ENV is not production
    And LANGWATCH_DEFAULT_RETENTION_DAYS is 10
    When the platform retention default is resolved
    Then start-up fails with an error about whole weeks
