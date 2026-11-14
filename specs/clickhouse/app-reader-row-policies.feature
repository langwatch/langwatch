Feature: ClickHouse row policies bound the application's reads to the request's tenants

  As the LangWatch platform reading tenant rows from ClickHouse
  I want a restricted reader identity whose row policies admit only the tenants a request names
  So that a missing or wrong tenant predicate in any read returns no foreign rows

  ADR-202, slice 1 (dev/docs/plans/clickhouse-row-policies-scope.md). The reader joins the
  LangWatchQL access model (ADR-159) and is delivered by its two emitters. The client does not
  send the tenant setting yet; that is slice 2. Until a target enforces, the profile pins the
  enforce switch to 0 and every row stays visible (shadow).

  # ---------------------------------------------------------------------------
  # The definition
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The access model defines the app reader beside the LangWatchQL identity
    Given the access-model definition built with the app reader's credential
    Then it defines the user "langwatch_app_reader" carrying the profile "langwatch_app_reader_profile"
    And the LangWatchQL user, profile, grants and policies are the ones it renders without the reader

  @unit
  Scenario: The app reader's profile starts with an empty tenant set and pins the rest
    Given the app reader's settings profile
    Then "SQL_langwatch_tenant_ids" defaults to empty and stays changeable per query
    And "SQL_langwatch_tenancy_enforce" is pinned CONST at 0 unless the target enforces
    And "use_query_cache", "use_query_condition_cache" and "allow_introspection_functions" are pinned CONST at 0

  @unit
  Scenario: Every app reader row policy admits only the request's tenants once enforced
    Given the app reader's row policies
    Then each one admits every row while the enforce switch is 0
    And otherwise admits only rows whose tenant column is a non-empty id in "SQL_langwatch_tenant_ids"
    And "stored_objects" is bounded on "project_id" and every other tenant table on "TenantId"

  @unit
  Scenario: The app reader cannot read its own query log
    Given the access-model definition built with the app reader's credential
    Then the app reader carries a row policy admitting no row on "system.user_query_log"
    And it is granted nothing in the "system" database
    And the DDL and users.d emitters both render that policy

  @unit
  Scenario: App reader policies never share a name with a LangWatchQL policy
    Given the access-model definition built with the app reader's credential
    Then no app reader policy has the name of a LangWatchQL policy on the same table

  @unit
  Scenario: The app reader is granted SELECT on the tenant tables and nothing else
    Given the access-model definition built with the app reader's credential
    Then the app reader's grants are SELECT on exactly the tables its row policies bound

  @unit
  Scenario: The DDL and users.d emitters render the same app reader
    Given the access-model definition built with the app reader's credential
    When the SQL DDL emitter and the users.d emitter both render it
    Then both carry the same app reader user, profile settings, constraints, grants and row policies

  @unit
  Scenario: No row policy binds the system identity
    Given the access-model definition built with the app reader's credential
    When the SQL DDL emitter and the users.d emitter both render it
    Then every row policy binds the LangWatchQL user or the app reader, and no other identity

  # ---------------------------------------------------------------------------
  # Guards over the migrations
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every table the migrations leave with a tenant column has an app reader policy
    Given the ClickHouse migrations replayed into the tables they leave behind
    Then every table carrying "TenantId" or "project_id" has an app reader policy on that column, or is classified as never granted with its reason
    And a table carrying neither fails the guard by name until it is classified
    And no app reader policy or classification names a table the migrations do not leave

  @unit
  Scenario: The app reader is never granted the LangWatchQL key map or eventing's log
    Given the ClickHouse migrations replayed into the tables they leave behind
    Then "lwql_api_key_tenant_map", "event_log" and "event_log_id_index" are classified as never granted to the app reader
    And the access-model definition gives the app reader no grant and no row policy on any of them

  @unit
  Scenario: Every deduplicating tenant table leads its sorting key with its tenant column
    Given the ClickHouse migrations replayed into the tables they leave behind
    When a table's engine collapses rows (Replacing, Aggregating, Collapsing or Summing)
    Then its sorting key starts with its tenant column, or it is a named exception with its reason
    And every named exception still keeps its tenant column inside the sorting key

  # ---------------------------------------------------------------------------
  # Against a real ClickHouse 26.8, provisioned with the rendered DDL
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An enforcing reader naming tenant A reads only tenant A's rows in every query shape
    Given the app reader provisioned from the rendered DDL with enforce pinned to 1
    And rows of tenants A and B in the tenant tables, sharing the join keys across tenants
    And a row of tenant B alone on the inner side of a join and of an IN subquery
    When the reader runs a plain read, a CTE, a UNION ALL, inner, left and right joins, a subquery and an IN subquery with "SQL_langwatch_tenant_ids" naming tenant A
    Then every result holds exactly tenant A's rows, counted, on both sides of every join

  @integration
  Scenario: The tenant set is read as exact comma-separated ids
    Given the app reader provisioned from the rendered DDL with enforce pinned to 1
    And rows of a tenant whose id has tenant A's id as a prefix
    When the reader names tenant A, the longer id, their shared prefix, empty entries, a space before an id, or tenants A and B
    Then it reads the rows of each id named exactly, and an entry carrying a space or a bare prefix matches no tenant

  @integration
  Scenario: A reader for one tenant cannot read another tenant's logged statements
    Given the app reader provisioned from the rendered DDL with enforce pinned to 1
    And the reader ran a statement for tenant B, which the server logged
    When the reader for tenant A reads "system.user_query_log"
    Then it reads none of tenant B's statements
    And reading "system.query_log", "system.processes", "system.query_views_log" or "system.text_log" is refused for want of a grant

  @integration
  Scenario: An enforcing reader without a tenant set reads no rows
    Given the app reader provisioned from the rendered DDL with enforce pinned to 1
    When the reader reads a tenant table without "SQL_langwatch_tenant_ids"
    Then it reads no rows, including rows whose tenant column is empty

  @integration
  Scenario: A shadow reader reads every tenant's rows
    Given the app reader provisioned from the rendered DDL with enforce pinned to 0
    When the reader reads a tenant table with or without "SQL_langwatch_tenant_ids"
    Then it reads every tenant's rows

  @integration
  Scenario: The reader cannot change the enforce switch or the cache pins
    Given the app reader provisioned from the rendered DDL
    When the reader sets "SQL_langwatch_tenancy_enforce" or "use_query_condition_cache" to another value, per request or in a SETTINGS clause
    Then ClickHouse refuses the query with a setting constraint violation

  @integration
  Scenario: The system identity reads every tenant's rows while the reader is enforced
    Given the app reader provisioned from the rendered DDL with enforce pinned to 1
    When the administrative identity reads a tenant table
    Then it reads every tenant's rows

  @integration
  Scenario: The app reader's tenant predicate prunes on the primary key
    Given the app reader provisioned from the rendered DDL with enforce pinned to 1
    When the reader's read of a table ordered by its tenant column is explained with its indexes
    Then the primary key selects fewer granules than the table holds
