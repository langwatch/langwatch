Feature: The clickhouse-tenant-id lint rule
  No id but TenantId is unique across tenants, so every table a ClickHouse
  repository reads or mutates filters on the tenant in its own WHERE
  (dev/docs/best_practices/clickhouse-queries.md, "TenantId is Always Required").
  The client refuses a statement with no tenant predicate at runtime; this rule
  catches it at edit time and holds each subquery to the same bar. A statement
  that genuinely spans tenants declares `unscoped: { reason }`, which the client
  audits, and a WHERE clause handed over by a builder is trusted to carry it.

  @unit
  Scenario: A query that reads a table without a TenantId predicate is reported
    Given a ClickHouse repository query that reads agent_runs filtered only by RunId
    When the clickhouse-tenant-id rule runs over it
    Then it reports missingTenantPredicate on the query's line, naming agent_runs

  @unit
  Scenario: A query that filters TenantId on a bound parameter is left alone
    Given queries filtering TenantId, a TenantId IN list or project_id on a bound parameter
    When the clickhouse-tenant-id rule runs over them
    Then it reports nothing

  @unit
  Scenario: A subquery without its own tenant predicate is reported
    Given a tenant-scoped query whose IN subquery reads agent_spans with no tenant predicate
    When the clickhouse-tenant-id rule runs over it
    Then it reports missingTenantPredicate naming agent_spans only

  @unit
  Scenario: A statement declared unscoped is left alone
    Given a query passed with `unscoped: { reason }` inline
    And a query passed to a method of the same class that declares `unscoped`
    When the clickhouse-tenant-id rule runs over them
    Then it reports nothing

  @unit
  Scenario: A WHERE clause handed over by a builder is left alone
    Given a query whose WHERE is an interpolated fragment or a `${buildXWhere()}` call
    When the clickhouse-tenant-id rule runs over it
    Then it reports nothing

  @unit
  Scenario: System tables and common table expressions are not tenant tables
    Given queries reading system.mutations, a CTE defined in the same file, a CTE a WITH builder names, a trim operand and a table function
    When the clickhouse-tenant-id rule runs over them
    Then it reports nothing

  @unit
  Scenario: Files outside ClickHouse repositories are not checked
    Given the same unscoped query in a service and in a repository test
    When the clickhouse-tenant-id rule runs over them
    Then it reports nothing
