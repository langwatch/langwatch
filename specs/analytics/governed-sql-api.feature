Feature: Governed analytics SQL API — read-only native ClickHouse SQL over analytics.* with tenant isolation

  As an authenticated LangWatch API client
  I want to discover a governed analytics schema and execute native ClickHouse SQL against it
  So that I can answer analytical questions beyond the built-in endpoints without ever
  reading another tenant's data or writing anything

  Issue: #6480. Supersedes #6346 and #5670 — direction reversed: native SQL, no custom language.

  Isolation model under proof (the issue's settled design):
  - Shared restricted ClickHouse user with readonly enforcement.
  - Per-query tenant context passed as an API-key-hash capability in a custom setting
    marked changeable_in_readonly; the hash is an unguessable capability, so possession
    of a victim's valid key hash — not the ability to write a SETTINGS clause — is the
    security boundary at the database layer. The gateway's AST validator additionally
    rejects any SETTINGS clause as defense in depth.
  - Row policies resolve the tenant through a key-map lookup keyed on that setting.
  - All other settings are pinned by profile constraints, so a smuggled SETTINGS
    clause for anything but the tenant capability is rejected outright.
  - PG-resident data is reached through server-side named-collection PostgreSQL-engine
    tables in ClickHouse (no PG endpoint, no PG executor), row-policed identically.

  The "isolation proof" scenarios below are the first implementation step and gate the
  rest of the issue: they execute directly as the restricted database identity against
  the deployed ClickHouse 25.10 image plus a real PostgreSQL container (Testcontainers).
  No tenant-isolation or read-only scenario may be satisfied by a validator-only test.

  Background:
    Given a ClickHouse test server on the deployed 25.10 image with the governed analytics setup applied
    And tenants "tenant-a" and "tenant-b" each have seeded analytical rows

  # ---------------------------------------------------------------------------
  # Isolation proof, part 1: row-policy enforcement as the restricted identity
  # (bound in this PR — Testcontainers, executing as the restricted user)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Restricted identity with a valid key context reads only its own tenant's rows
    Given the restricted identity carries tenant-a's valid key-hash context
    When it selects from a governed table
    Then every returned row belongs to tenant-a
    And no row of tenant-b is returned

  @integration
  Scenario: Empty key context yields zero rows, never all rows
    Given the restricted identity carries an empty key-hash context
    When it selects from a governed table
    Then zero rows are returned

  @integration
  Scenario: Garbage key context yields zero rows, never all rows
    Given the restricted identity carries a key-hash context matching no key-map entry
    When it selects from a governed table
    Then zero rows are returned

  @integration
  Scenario: Overriding the tenant setting in query text cannot reach another tenant's rows without that tenant's valid key hash
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes a query whose SQL text overrides the tenant setting with a guessed value
    Then no tenant-b row is returned

  @integration
  Scenario: Overriding a pinned setting in query text is rejected by profile constraints
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes a query whose SQL text attempts to change a pinned setting
    Then the query is rejected with a settings-constraint error

  @integration
  Scenario: Row policy holds inside a CTE
    Given the restricted identity carries tenant-a's valid key-hash context
    When it selects from a governed table through a WITH clause
    Then no tenant-b row is reachable through the CTE

  @integration
  Scenario: Row policy holds across UNION ALL branches
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes a UNION ALL whose branches select from governed tables
    Then no branch returns a tenant-b row

  @integration
  Scenario: Row policy holds on both sides of a JOIN
    Given the restricted identity carries tenant-a's valid key-hash context
    When it joins two governed tables
    Then neither join side contributes a tenant-b row

  @integration
  Scenario: Row policy holds inside subqueries
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes queries using IN, EXISTS, and scalar subqueries over governed tables
    Then no subquery position leaks a tenant-b row

  @integration
  Scenario: Key hash is auditable in the query log without exposing the raw key
    Given the restricted identity ran a query carrying tenant-a's key-hash context
    When the server's query log is inspected for that query
    Then the log entry carries the key hash
    And the raw API key appears nowhere in the log entry

  @integration
  Scenario: Revoking a key hash from the key map takes effect within the stated revocation bound
    Given the restricted identity carries tenant-a's valid key-hash context
    And tenant-a's key hash is removed from the key map
    When it selects from a governed table
    Then zero rows are returned

  @integration
  Scenario: The restricted identity cannot enumerate the key map beyond its own key
    Given the restricted identity carries tenant-a's valid key-hash context
    When it attempts to read the key map
    Then it cannot obtain any other tenant's key hash

  @integration
  Scenario: Writes, DDL, and temporary objects are rejected by the restricted identity itself
    Given the restricted identity carries tenant-a's valid key-hash context
    When it attempts INSERT, ALTER, CREATE TABLE, CREATE TEMPORARY TABLE, and DROP statements
    Then every attempt is rejected by the database

  @integration
  Scenario: Multiple statements in one request are rejected
    Given the restricted identity carries tenant-a's valid key-hash context
    When it submits two statements in a single request
    Then the request is rejected

  @integration
  Scenario: Table functions are rejected for the restricted identity by grants
    Given the restricted identity carries tenant-a's valid key-hash context
    When it attempts queries using url, s3, remote, file, and postgresql table functions
    Then every attempt is rejected by the database

  @integration
  Scenario: System and internal schema access is rejected for the restricted identity
    Given the restricted identity carries tenant-a's valid key-hash context
    When it attempts to select from system tables holding users, settings, and query history
    Then every attempt is rejected by the database

  # ---------------------------------------------------------------------------
  # Isolation proof, part 2: PG-resident data via named-collection
  # PostgreSQL-engine tables (bound in this PR — real PostgreSQL container)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A PG-resident table is readable through ClickHouse only within the caller's tenant rows
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries tenant-a's valid key-hash context
    When it selects from the mapped table
    Then every returned row belongs to tenant-a
    And no row of tenant-b is returned

  @integration
  Scenario: Garbage key context yields zero rows from a PG-engine mapped table
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries a key-hash context matching no key-map entry
    When it selects from the mapped table
    Then zero rows are returned

  @integration
  Scenario: Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries tenant-a's valid key-hash context
    When it queries the mapped table through CTE, UNION ALL, JOIN, and subquery shapes
    Then no shape leaks a tenant-b row from the mapped table

  @integration
  Scenario: The restricted identity cannot write through a PG-engine mapped table
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries tenant-a's valid key-hash context
    When it attempts to INSERT into the mapped table
    Then the attempt is rejected by the database

  @integration
  Scenario: The dedicated PG role is read-only at the PostgreSQL layer
    Given the named collection connects as the dedicated PG role
    When a write is attempted on PostgreSQL as that role
    Then PostgreSQL rejects the write
    And the role can select only from the explicitly approved views

  @integration
  Scenario: PG connection credentials are not exposed to the restricted identity
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    When the restricted identity inspects the mapped table's definition and the server's named collections
    Then no PostgreSQL credential is revealed

  # ---------------------------------------------------------------------------
  # Public API (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: gateway endpoints are a later PR of #6480; the isolation
  # proof above gates them.
  @integration @unimplemented
  Scenario: Authenticated client discovers its governed schema scoped to its own permissions
    Given an authenticated API client
    When it calls the schema discovery endpoint
    Then it receives the governed analytics datasets with descriptions, types, units, grain, freshness, allowed joins, content restrictions, and example SQL
    And datasets outside its permissions are absent

  # @unimplemented: gateway endpoints are a later PR of #6480.
  @integration @unimplemented
  Scenario: Client executes native ClickHouse SQL through the documented REST endpoint
    Given an authenticated API client
    When it submits native ClickHouse SQL using joins, window functions, comparisons, percentiles, aliases, math, CTEs, and subqueries
    Then the query executes and returns tabular results

  # @unimplemented: gateway endpoints are a later PR of #6480.
  @integration @unimplemented
  Scenario: Results carry typed columns, rows, execution statistics, truncation state, and diagnostics
    Given an authenticated API client
    When it executes a governed query
    Then the response contains typed columns, rows, execution statistics, truncation state, and structured diagnostics

  # @unimplemented: gateway endpoints are a later PR of #6480.
  @integration @unimplemented
  Scenario: Parameterized queries re-run deterministically through the REST API
    Given an authenticated API client
    When it re-submits the same parameterized query with the same bound parameters
    Then the result is identical across runs over unchanged data

  # ---------------------------------------------------------------------------
  # Answerable-question coverage (later PR of this issue — #6480)
  # Each case is fixture-backed with at least two tenants, only the
  # authenticated tenant contributing, asserted through the public gateway.
  # ---------------------------------------------------------------------------

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Latency percentiles by model in time buckets
    Given seeded traces for two tenants
    When the client asks for p50, p95, and p99 latency by model in time buckets
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Error rate versus the previous equivalent period
    Given seeded traces for two tenants spanning two periods
    When the client compares error rate against the previous equivalent period
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Rolling windows over trace metrics
    Given seeded traces for two tenants
    When the client computes a one-hour rolling error rate
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Cost by project, model, and prompt version via dimension joins by name
    Given seeded generations and dimension data for two tenants
    When the client aggregates cost by project, model, and prompt-version names through dimension joins
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Token and cost outliers
    Given seeded generations for two tenants
    When the client asks for token and cost outliers
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Evaluation score distributions and pass rates by model and prompt version
    Given seeded evaluations for two tenants
    When the client asks for score distributions and pass rates by model and prompt version
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480;
  # the annotations mechanism is whichever is in effect for that table (PG-engine join, or
  # the projection fallback if it has been triggered).
  @integration @unimplemented
  Scenario: Annotation-versus-evaluation agreement
    Given seeded annotations and evaluations for two tenants
    When the client asks how often human thumbs agree with evaluator pass results
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Traces containing operation A then operation B
    Given seeded traces with ordered spans for two tenants
    When the client asks for traces where operation A precedes operation B
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Time between two events in a trace
    Given seeded traces with ordered spans for two tenants
    When the client asks for the elapsed time between two named events per trace
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: First failure and first retry per trace
    Given seeded traces with failures and retries for two tenants
    When the client asks for the first failure and first retry per trace
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Experiment run comparisons
    Given seeded experiment runs for two tenants
    When the client compares metrics across experiment runs
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented: fixture-backed acceptance cases land with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Fanout warning on a trace-to-span join
    Given seeded traces and spans for two tenants
    When the client aggregates at trace grain after joining spans
    Then the response carries a POSSIBLE_FANOUT diagnostic naming the affected columns with evidence

  # ---------------------------------------------------------------------------
  # Tenant isolation and authorization at the gateway (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: gateway behavior lands with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Tenant scope derives exclusively from authenticated server context
    Given an authenticated API client
    When it attempts to supply, override, inspect, or widen tenant scope via SQL text or request parameters
    Then the attempt is rejected or ignored and only the authenticated tenant's data is reachable

  # @unimplemented: content-gating parity lands with the schema/catalog PR of #6480.
  @integration @unimplemented
  Scenario: Content-gated fields are refused in every expression position
    Given an authenticated API client without content permissions
    When it references a content-gated field in projection, filter, group, order, having, join, window, or subquery position
    Then the query is rejected
    And the gated-field set matches the canonical visibility policy

  # ---------------------------------------------------------------------------
  # Read-only, exfiltration, and fail-closed behavior at the gateway
  # (later PR of this issue — #6480; the database-identity half is bound above)
  # ---------------------------------------------------------------------------

  # @unimplemented: gateway AST policy lands with the validator PR of #6480.
  @integration @unimplemented
  Scenario: External and table-function access is blocked by AST policy before reaching the database
    Given an authenticated API client
    When it submits SQL using postgresql, url, s3, remote, or any table function
    Then the gateway rejects the query by AST policy

  # @unimplemented: gateway error envelope lands with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Query database credentials never reach the caller
    Given an authenticated API client
    When any governed query succeeds or fails
    Then no response or error ever contains database credentials, server settings, physical internal table names, or another tenant's existence

  # @unimplemented: fail-closed wiring lands with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Missing parser, restricted identity, or row policy fails closed
    Given the parser, the restricted identity, or the row-policy setup is unavailable
    When a client submits a governed query
    Then the query is rejected rather than executed with weaker guarantees

  # ---------------------------------------------------------------------------
  # Resource safety (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: resource governance lands with the executor PR of #6480.
  @integration @unimplemented
  Scenario: Database-enforced ceilings bound every resource dimension
    Given the governed execution profile
    When queries approach time, memory, scan, join, aggregation, sort, temp-disk, AST-complexity, result-size, and per-tenant concurrency limits
    Then each ceiling is enforced by the database or gateway configuration

  # @unimplemented: resource governance lands with the executor PR of #6480.
  @integration @unimplemented
  Scenario: A pathological join is contained within its resource envelope
    Given an authenticated API client
    When it submits a pathological join
    Then the query is rejected or terminated within its resource envelope
    And other tenants' queries continue to execute

  # @unimplemented: resource governance lands with the executor PR of #6480.
  @integration @unimplemented
  Scenario: Overflow throws and never silently truncates
    Given an authenticated API client
    When a query exceeds any resource limit
    Then the client receives a machine-readable error
    And no unmarked partial result is returned

  # ---------------------------------------------------------------------------
  # Diagnostics (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: diagnostics rules land with the diagnostics PR of #6480.
  @integration @unimplemented
  Scenario: Truncation diagnostic fires when results are cut off
    Given an authenticated API client
    When a query's results are truncated by the result-size limit
    Then the response marks truncation explicitly

  # @unimplemented: diagnostics rules land with the diagnostics PR of #6480.
  @integration @unimplemented
  Scenario: Incomplete or misaligned comparison period diagnostic fires
    Given an authenticated API client
    When a query compares periods of unequal or incomplete coverage
    Then the response carries the comparison-period diagnostic

  # @unimplemented: diagnostics rules land with the diagnostics PR of #6480.
  @integration @unimplemented
  Scenario: Missing time buckets diagnostic fires
    Given an authenticated API client
    When a time-bucketed query has empty buckets in range
    Then the response carries the missing-time-buckets diagnostic

  # @unimplemented: documentation copy lands with the diagnostics PR of #6480.
  @unit @unimplemented
  Scenario: Clean diagnostic status is documented as no known issue detected
    Given the diagnostics documentation
    When the clean status is described
    Then it reads as "no known issue detected" and never as proof of correctness

  # ---------------------------------------------------------------------------
  # Reaching PostgreSQL-resident data: decision end-state (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: the per-table measurement record and any projection fallback
  # land with the PG-mapping PR of #6480; measurements are recorded in that PR
  # before any projection is built.
  @integration @unimplemented
  Scenario: A PG-resident table that fails the measured bar is served via projection instead
    Given per-table p95 latency and load-on-primary measurements recorded for each PG-resident table
    When a table fails the measured bar
    Then that table is served from a ClickHouse projection
    And the fallback is documented per table

  # @unimplemented: the annotations end-state lands with the PG-mapping PR of #6480.
  @integration @unimplemented
  Scenario: Annotation data has exactly one source at ship time
    Given the shipped annotations mechanism
    When annotation data is queried through the governed schema
    Then it comes from exactly one source
    And the partial AnnotationIds projection is either removed or widened, not left half-done

  # ---------------------------------------------------------------------------
  # Non-goals held as scope guards (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: route-absence guard lands with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: No PostgreSQL native-SQL execution endpoint exists
    Given the public API surface
    When a client attempts to execute SQL against a PostgreSQL query endpoint
    Then no such endpoint exists

  # @unimplemented: dependency guard lands with the validator PR of #6480.
  @unit @unimplemented
  Scenario: No custom query language and no new BI platform dependency ships
    Given the application's dependency manifest and source tree
    When inspected for a custom query grammar, compiler, IR, or a Cube or Trino dependency
    Then none is present

  # @unimplemented: no-rewrite guarantee lands with the executor PR of #6480.
  @integration @unimplemented
  Scenario: Submitted SQL is never automatically rewritten
    Given an authenticated API client
    When it submits a governed query
    Then the SQL the database executes is the submitted statement, not a rewritten one
    And no UI or natural-language translation layer is involved

  # @unimplemented: the ADR lands alongside the table-function policy wiring in #6480.
  @unit @unimplemented
  Scenario: The table-function and SSRF policy is captured as an ADR
    Given the repository's ADR index
    When the table-function and SSRF policy is looked up
    Then a dedicated ADR documents why user-supplied table functions remain blocked via AST and grants

# --- AC Coverage Map ---
# Issue #6480 ACs → scenarios (grouped as in the issue body).
#
# Isolation verification (first step, gates the rest):
# AC "Testcontainers suite against CH 25.10 proves: SQL-text override attempts fail"
#   → Scenario: Overriding the tenant setting in query text cannot reach another tenant's rows without that tenant's valid key hash
#   → Scenario: Overriding a pinned setting in query text is rejected by profile constraints
# AC "row policy holds under CTE/UNION/JOIN/subquery"
#   → Scenario: Row policy holds inside a CTE
#   → Scenario: Row policy holds across UNION ALL branches
#   → Scenario: Row policy holds on both sides of a JOIN
#   → Scenario: Row policy holds inside subqueries
# AC "empty/garbage key context yields zero rows, never all rows"
#   → Scenario: Empty key context yields zero rows, never all rows
#   → Scenario: Garbage key context yields zero rows, never all rows
# AC "key-hash appears in query_log without exposing the raw key"
#   → Scenario: Key hash is auditable in the query log without exposing the raw key
# AC "key-map refresh has a bounded revocation lag"
#   → Scenario: Revoking a key hash from the key map takes effect within the stated revocation bound
# (supporting invariants of the same proof: baseline read, key-map hygiene, multi-statement)
#   → Scenario: Restricted identity with a valid key context reads only its own tenant's rows
#   → Scenario: The restricted identity cannot enumerate the key map beyond its own key
#   → Scenario: Multiple statements in one request are rejected
#
# Product:
# AC "schema discovery scoped to own permissions" → Scenario: Authenticated client discovers its governed schema scoped to its own permissions
# AC "execute native ClickHouse SQL via REST" → Scenario: Client executes native ClickHouse SQL through the documented REST endpoint
# AC "typed columns, rows, stats, truncation, diagnostics" → Scenario: Results carry typed columns, rows, execution statistics, truncation state, and diagnostics
# AC "parameterized queries re-run deterministically" → Scenario: Parameterized queries re-run deterministically through the REST API
#
# Answerable-question coverage (one scenario each, same titles in order):
# p50/p95/p99 → Latency percentiles by model in time buckets
# error rate vs previous period → Error rate versus the previous equivalent period
# rolling windows → Rolling windows over trace metrics
# cost by project/model/prompt-version → Cost by project, model, and prompt version via dimension joins by name
# token/cost outliers → Token and cost outliers
# evaluation distributions/pass rates → Evaluation score distributions and pass rates by model and prompt version
# annotation-vs-evaluation agreement → Annotation-versus-evaluation agreement
# A then B → Traces containing operation A then operation B
# time between events → Time between two events in a trace
# first failure/retry → First failure and first retry per trace
# experiment comparisons → Experiment run comparisons
# fanout warning → Fanout warning on a trace-to-span join
#
# Tenant isolation and authorization:
# AC "scope derived exclusively from server context" → Scenario: Tenant scope derives exclusively from authenticated server context
# AC "row policies independently prevent cross-tenant reads, verified against the restricted identity"
#   → the bound isolation-proof scenarios (baseline + CTE/UNION/JOIN/subquery above)
# AC "content-gated fields refused in every expression position" → Scenario: Content-gated fields are refused in every expression position
# AC "row-policy + zero-rows-on-garbage-key on PG-engine mapped tables (PG container)"
#   → Scenario: A PG-resident table is readable through ClickHouse only within the caller's tenant rows
#   → Scenario: Garbage key context yields zero rows from a PG-engine mapped table
#   → Scenario: Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes
#   ("for every table still served via the named collection at ship time" is enforced when
#    the shipped table list exists — the mapped-table proof harness is parameterized by table)
#
# Reaching PostgreSQL-resident data:
# AC "per-table latency + load measurements recorded before projections" → recorded in the
#    PG-mapping PR (process AC); gated behaviorally by:
#   → Scenario: A PG-resident table that fails the measured bar is served via projection instead
# AC "failing tables fall back to projection, documented" → same scenario
# AC "AnnotationIds partial projection resolved one way" → Scenario: Annotation data has exactly one source at ship time
#
# Read-only and exfiltration:
# AC "single read query; writes/DDL/roles/settings/temp/system rejected by the identity"
#   → Scenario: Writes, DDL, and temporary objects are rejected by the restricted identity itself
#   → Scenario: Multiple statements in one request are rejected
#   → Scenario: Overriding a pinned setting in query text is rejected by profile constraints
#   → Scenario: System and internal schema access is rejected for the restricted identity
# AC "table functions blocked by AST policy and grants"
#   → Scenario: Table functions are rejected for the restricted identity by grants
#   → Scenario: External and table-function access is blocked by AST policy before reaching the database
# AC "credentials never reach the caller"
#   → Scenario: PG connection credentials are not exposed to the restricted identity
#   → Scenario: Query database credentials never reach the caller
# AC "missing parser/identity/policy fails closed" → Scenario: Missing parser, restricted identity, or row policy fails closed
#
# Resource safety:
# AC "database-enforced ceilings" → Scenario: Database-enforced ceilings bound every resource dimension
# AC "pathological join contained; no tenant monopoly" → Scenario: A pathological join is contained within its resource envelope
# AC "overflow throws, never silent truncation" → Scenario: Overflow throws and never silently truncates
#
# Diagnostics:
# AC "four rules, each fixture-triggered"
#   → Scenario: Fanout warning on a trace-to-span join (POSSIBLE_FANOUT)
#   → Scenario: Truncation diagnostic fires when results are cut off
#   → Scenario: Incomplete or misaligned comparison period diagnostic fires
#   → Scenario: Missing time buckets diagnostic fires
# AC "clean = no known issue detected" → Scenario: Clean diagnostic status is documented as no known issue detected
#
# Non-goals:
# AC "no PostgreSQL native-SQL endpoint" → Scenario: No PostgreSQL native-SQL execution endpoint exists
# AC "no custom query language/grammar/compiler/IR" → Scenario: No custom query language and no new BI platform dependency ships
# AC "no Cube/Trino/BI platform" → same scenario
# AC "no UI, NL-to-SQL, or automatic query rewriting" → Scenario: Submitted SQL is never automatically rewritten
# AC "ADR documents the table-function/SSRF policy" → Scenario: The table-function and SSRF policy is captured as an ADR
#
# PG-role containment invariants from the design (named-collection role limits):
#   → Scenario: The dedicated PG role is read-only at the PostgreSQL layer
#   → Scenario: The restricted identity cannot write through a PG-engine mapped table
