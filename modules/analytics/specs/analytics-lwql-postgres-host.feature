Feature: LangWatchQL reaches Postgres at an address ClickHouse can dial

  The lwql_postgres named collection is written from DATABASE_URL. When
  ClickHouse runs somewhere that URL's host does not resolve to Postgres (a
  container that sees 127.0.0.1 as itself), LWQL_POSTGRES_HOST names the
  address ClickHouse dials instead. Nothing else in the stack changes host.

  @unit
  Scenario: The named collection dials the database URL's host by default
    Given DATABASE_URL names the host "127.0.0.1" and LWQL_POSTGRES_HOST is unset
    When the LangWatchQL self-provision request is derived
    Then the Postgres endpoint host is "127.0.0.1"

  @unit
  Scenario: LWQL_POSTGRES_HOST overrides the host the named collection dials
    Given DATABASE_URL names the host "127.0.0.1" and LWQL_POSTGRES_HOST is "host.lima.internal"
    When the LangWatchQL self-provision request is derived
    Then the Postgres endpoint host is "host.lima.internal"
    And the endpoint keeps the URL's port and database
