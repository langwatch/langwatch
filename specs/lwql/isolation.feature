Feature: LangWatchQL never answers across a tenant or an instance

  As an organisation querying its data with LangWatchQL
  I want every answer to come only from my own rows, on the server that holds them
  So that no other tenant, instance or server ever sees my data or the key to it

  # ADR-200. The gate decides before any SQL runs and fails closed; ClickHouse
  # isolates tenants on the server (ADR-084). Integration scenarios run against a
  # real ClickHouse 26.8 through lwql-clickhouse-harness.ts (LWQL_ISOLATION_CLICKHOUSE_IMAGE).

  # --- The placement gate -------------------------------------------------

  @unit
  Scenario: An organisation on the shared server is answered
    Given an organisation whose data is on the server LangWatchQL is provisioned on
    When it runs a LangWatchQL query
    Then the gate lets the query through to the executor

  @unit
  Scenario: An organisation routed to its own ClickHouse is refused before any SQL runs
    Given an organisation whose data is on a private instance or its own ClickHouse
    When it runs a LangWatchQL query
    Then it is refused with error code lwql_not_provisioned
    And the executor is never called, so the shared server is never queried for it

  @unit
  Scenario: A gate that cannot decide refuses rather than falling back
    Given the organisation's route cannot be read
    When it runs a LangWatchQL query
    Then it is refused with error code lwql_unavailable
    And the executor is never called

  @unit
  Scenario: An organisation recorded private whose route is missing is refused, never shared
    Given an organisation recorded as keeping its data on its own ClickHouse
    And this process has no route variable for it, so the router resolves the shared server
    When it runs a LangWatchQL query
    Then it is refused with error code lwql_unavailable
    And the executor is never called

  @unit
  Scenario: A self-hosted install answers only once LangWatchQL is enabled and provisioned
    Given a self-hosted install whose ClickHouse has no LangWatchQL access model
    When a LangWatchQL query runs
    Then it is refused with error code lwql_not_provisioned
    And once the access model is provisioned and the last answer has expired, the same query is answered

  @unit
  Scenario: Every LangWatchQL entry point passes the gate
    Given the API, saved charts, the workbench and the CLI verbs that run LangWatchQL
    When each runs a query for an organisation routed to its own ClickHouse
    Then each refuses with error code lwql_not_provisioned

  # --- The capability stays on the LangWatchQL server ----------------------

  @unit
  Scenario: A routed project's key-map row is written only to the LangWatchQL server
    Given a project whose organisation is routed to its own ClickHouse
    When its key-map row is synced
    Then the row is written through the LangWatchQL admin target
    And the tenant's routed client is never asked for

  @integration
  Scenario: The capability never appears in a request URL or a server log
    Given the executor runs a query for a tenant against a real ClickHouse
    When the request is sent
    Then the capability is carried in the statement body, not the URL
    And neither system.text_log nor the server log file holds the capability

  # --- Isolation on the server, as each other user sees it ----------------

  @integration
  Scenario: The restricted user never reads another tenant's rows through any system table
    Given two tenants with rows on a real ClickHouse
    When the restricted user queries system.processes, user_processes, text_log, query_thread_log, query_views_log, part_log, session_log, opentelemetry_span_log and asynchronous_insert_log
    Then each is refused

  @integration
  Scenario: The query condition cache never carries one tenant's result into another's
    Given two tenants with rows, and a query condition cache the restricted user can never turn on
    When tenant A runs a filtered query and tenant B runs the same SQL
    Then tenant B's count equals its count with the cache off
    And tenant A never sees tenant B's rows

  @integration
  Scenario: The restricted user gets only what it is granted: no cache, no dictionary, no table function, and a revoked key reads nothing at once
    Given the restricted user, whose profile pins the query and condition caches and introspection off
    When it sets either cache on, or the server's default profile turns the result cache on
    Then the setting is refused, and each tenant gets its own count with nothing cached
    And its grants are exactly the LangWatchQL tables, so dictGet, remote, url, file and s3 are refused
    And a key whose key-map row is deleted reads nothing on the very next query

  @integration
  Scenario: The named collection's keys cannot be redirected
    Given a user allowed to use the lwql_postgres collection but not to read its secrets
    When it creates a PostgreSQL table or calls postgresql() on the collection with another host
    Then both are refused, so the PostgreSQL login is never sent anywhere else

  @integration
  Scenario: A user with no row policy is the boundary, and it is documented
    Given a ClickHouse user granted the source database without a row policy
    When it reads the source tables and a PostgreSQL engine table
    Then it reads every tenant's rows
    And the access-model docs say that only the restricted identity is isolated

  @integration
  Scenario: One hash mapped to two tenants reads nothing
    Given a key-map hash bound to two tenants
    When the restricted user queries with that hash
    Then it reads zero rows

  # --- End to end, on a deployed stack -------------------------------------

  @e2e
  Scenario: On a deployed stack, each project's key reads only its own rows
    Given the chart deployed with two projects in two organisations, each with traces
    When each project's API key runs the same LangWatchQL count over traces
    Then each sees exactly its own trace count
    And a key for one project naming the other project's id is refused
