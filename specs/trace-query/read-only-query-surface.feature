# Read-only, tenant-isolated trace query surface — Gherkin Spec
# Issue: https://github.com/langwatch/langwatch/issues/5670  (SPIKE)
#
# Gives a LangWatch user self-serve, read-only query + aggregation access over
# their OWN trace data ("p95 latency by model where cost > $0.10 last 7 days").
# The industry reference is trigger.dev's TRQL: a compiler-enforced, read-only
# query surface. Security & privacy are the load-bearing requirement, not an
# afterthought — the #1 risk is cross-tenant data leakage.
#
# This spike composes two primitives LangWatch already owns:
#   Half 1 — translateFilterToClickHouse: tenant-injecting, parameterizing,
#            field-allowlisting liqe→ClickHouse filter compiler.
#   Half 2 — explain-core / ops: read-only ClickHouse exec infra (langwatch_ops
#            user, no SOURCES grant, readonly_safe profile, per-query guardrails).
# The net-new work is (a) EXECUTE aggregations (not just filter rows), and
# (b) enforce tenant scoping the ops endpoint deliberately omits.
#
# Two test layers, mirroring specs/analytics/clickhouse-memory-safety.feature:
#   1. SQL-structure assertions (@unit, no DB) — catch regressions instantly.
#   2. Adversarial + correctness proofs (@integration, real ClickHouse, two
#      tenants seeded) — the load-bearing evidence that isolation holds.

Feature: Read-only tenant-isolated trace query surface

  # ===========================================================================
  # SR-1 — Multi-tenant isolation (non-bypassable, compiler-injected)
  # The single most important property. The tenant predicate is injected by the
  # compiler on the OUTER query AND every subquery/branch, derived from the
  # authenticated session — never supplied or removable by the caller.
  # ===========================================================================

  Rule: Every table reference is scoped to the caller's tenant by the compiler

    Background:
      Given a user authenticated for tenant "acme"
      And the trace store also holds data for tenant "globex"

    @unit
    Scenario: The outer query carries a compiler-injected tenant predicate
      When the user compiles any query
      Then the emitted SQL constrains the outer table to "TenantId = {tenantId:String}"
      And the bound tenantId parameter equals the session's tenant, not any request field

    @unit
    Scenario: Every subquery, CTE, and UNION branch is independently tenant-scoped
      When the user compiles a query whose filter drills into span or event attributes
      Then each generated subquery constrains its table to "TenantId = {tenantId:String}"
      And no table reference in the emitted SQL lacks a tenant predicate

    @unit
    Scenario: A tenant id supplied in the request body is ignored
      Given the request body includes a "tenantId" field set to "globex"
      When the user compiles the query
      Then the bound tenantId parameter equals "acme" (from the session)
      And "globex" appears nowhere in the emitted SQL or its parameters

    @unit
    Scenario: Tenant scope cannot be commented-out or terminated by filter text
      When the user submits filter text attempting to close the predicate early or comment the rest
      Then the value is bound as a parameter, not interpolated into SQL
      And the tenant predicate remains intact in the emitted SQL

    @integration
    Scenario: An adversarial cross-tenant corpus returns zero foreign rows
      Given a running ClickHouse test container with schema applied
      And traces seeded for tenant "acme" and tenant "globex"
      When each query in the cross-tenant escape corpus is compiled and executed as tenant "acme"
      # corpus: subquery escape, UNION escape, CTE escape, correlated subquery,
      # alias tricks, parenthesization, group-by injection, aggregate-arg injection
      Then every result set contains only "acme" rows
      And zero "globex" rows are ever returned

    @integration
    Scenario: Aggregations never leak foreign rows into a bucket
      Given a running ClickHouse test container with schema applied
      And traces seeded for tenant "acme" and tenant "globex" sharing a model name
      When tenant "acme" runs "count() group by model"
      Then each per-model count reflects only "acme" traces
      And the totals never include "globex" traces

  # ===========================================================================
  # SR-2 — Read-only, enforced at two independent layers
  # ===========================================================================

  Rule: Destructive operations are inexpressible and independently blocked

    @unit
    Scenario: The query surface has no field that can carry a write
      When the query request type is inspected
      Then it exposes only aggregations, group-by, filter, time-range, and limit
      And there is no field through which INSERT/UPDATE/DELETE/DDL/mutations could be expressed

    @unit
    Scenario: Aggregation and column names are validated against an allowlist before SQL generation
      When the user requests an unknown aggregation function or column
      Then compilation fails before any SQL is generated
      And the error names the rejected identifier

    @integration
    Scenario: Execution runs under a read-only ClickHouse profile
      Given the query executor is configured with the read-only ops user and guardrails
      When any compiled query is executed
      Then the connection carries readonly=1 and the per-query caps
      And a write attempted through the same connection is refused by ClickHouse

  # ===========================================================================
  # SR-3 — Injection safety   /   SR-4 — Schema allowlisting
  # ===========================================================================

  Rule: All literals are bound parameters and all identifiers are allowlisted

    @unit
    Scenario: Filter and aggregation values are passed as bound parameters
      When the user compiles a query with literal filter and having values
      Then every literal appears as a "{name:Type}" bound parameter
      And no literal is string-interpolated into the SQL text

    @unit
    Scenario: Only allowlisted tables, columns, and functions are queryable
      When the user references an identifier outside the declared schema
      Then validation rejects it before SQL generation
      And system.* and information_schema are never reachable

  # ===========================================================================
  # SR-5 — No SSRF / local-file surface
  # ===========================================================================

  Rule: ClickHouse table functions are unreachable by grammar and by grant

    @unit
    Scenario: Table-function tokens cannot enter the emitted SQL
      When the user attempts to reference url(), s3(), remote(), file(), or executable()
      Then the identifier is not in the allowlist and compilation fails
      And the emitted SQL (when compilation is forced) contains no table-function call

    @integration @unimplemented
    Scenario: The executing DB user has no SOURCES grant
      Given the query executor uses the langwatch_ops-style read-only user
      When a table function is somehow reached
      Then ClickHouse refuses it at the access layer (no SOURCES grant)

  # ===========================================================================
  # SR-6 — Resource governance (load-bearing because we EXECUTE, not EXPLAIN)
  # ===========================================================================

  Rule: Every query is bounded in time, rows, wall-clock, and memory

    @unit
    Scenario: A query with no time range is rejected or auto-bounded
      When the user compiles a query without a time range
      Then compilation either rejects it or injects a default bounded range
      And the emitted SQL always constrains the partition-key time column

    @unit
    Scenario: The emitted SQL carries a LIMIT ceiling
      When the user compiles any query
      Then the emitted SQL includes a LIMIT no greater than the configured row cap

    @integration @unimplemented
    Scenario: A deliberately heavy query is stopped by the guardrails
      Given a running ClickHouse test container with schema applied
      When a query designed to exceed the wall-clock or memory cap is executed
      Then ClickHouse aborts it under the per-query caps
      And the caller receives a bounded error, not an unbounded scan

  # ===========================================================================
  # SR-8 — PII / sensitive-data handling   /   SR-9 — Auditability
  # ===========================================================================

  Rule: Payload columns are governed and every query is audited by redacted shape

    @unit @unimplemented
    Scenario: Raw payload columns are filter/aggregate-only by default
      When the user requests a raw input/output/attributes column in the projection
      Then the default column policy rejects returning the raw payload
      But the same column may be used inside a filter or aggregate

    @unit
    Scenario: The audit log records a redacted shape and hash, never raw literals
      When an accepted query is audit-logged
      Then the log stores the query shape with literals stripped plus a sha256
      And the tenant, caller, and resource outcome are recorded
      And no raw literal value appears in the audit record

  # ===========================================================================
  # Prototype demonstrability — the clickable boxd preview (spike floor)
  # ===========================================================================

  Rule: A user can run a read-only aggregation and see only their own data

    @integration
    Scenario: A user runs p95 latency by model over the last 7 days
      Given a user authenticated for a project with seeded traces
      When the user submits "p95(durationMs) group by model, last 7 days"
      Then the result shows one row per model with a p95 latency
      And the numbers reflect only that project's traces
