Feature: LangWatchQL analytics SQL API — read-only native ClickHouse SQL over analytics.* with tenant isolation

  As an authenticated LangWatch API client
  I want to discover a LangWatchQL analytics schema and execute native ClickHouse SQL against it
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
    Given a ClickHouse test server on the deployed 25.10 image with the LangWatchQL analytics setup applied
    And tenants "tenant-a" and "tenant-b" each have seeded analytical rows

  # ---------------------------------------------------------------------------
  # Isolation proof, part 1: row-policy enforcement as the restricted identity
  # (bound in this PR — Testcontainers, executing as the restricted user)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Restricted identity with a valid key context reads only its own tenant's rows
    Given the restricted identity carries tenant-a's valid key-hash context
    When it selects from a LangWatchQL table
    Then every returned row belongs to tenant-a
    And no row of tenant-b is returned

  @integration
  Scenario: Empty key context yields zero rows, never all rows
    Given the restricted identity carries an empty key-hash context
    When it selects from a LangWatchQL table
    Then zero rows are returned

  @integration
  Scenario: Garbage key context yields zero rows, never all rows
    Given the restricted identity carries a key-hash context matching no key-map entry
    When it selects from a LangWatchQL table
    Then zero rows are returned

  @integration
  Scenario: A caller that sends no tenant context at all reads nothing
    Given the restricted identity sends no tenant setting with its query
    When it selects from a LangWatchQL table
    Then the tenant setting resolves to the profile's empty default
    And zero rows are returned
    And no error is raised

  @integration
  Scenario: Detaching the row policy makes the other tenant's rows visible
    Given the restricted identity carries tenant-a's valid key-hash context
    And a LangWatchQL object holds rows for both tenants
    When the row policy is detached from that object
    Then tenant-b rows become visible to the restricted identity
    And reattaching the policy hides them again

  @integration
  Scenario: Overriding the tenant setting in query text cannot reach another tenant's rows without that tenant's valid key hash
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes a query whose SQL text overrides the tenant setting with a guessed value
    Then no tenant-b row is returned

  # No LangWatch error code applies here: the restricted identity executes below
  # the API boundary, so the stable code is ClickHouse's own. The same attempt
  # made through the gateway is refused earlier, as lwql_not_permitted
  # with a SETTINGS_CLAUSE violation.
  @integration
  Scenario: Overriding a pinned setting in query text is rejected by profile constraints
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes a query whose SQL text attempts to change a pinned setting
    Then the query is rejected by the database with ClickHouse error READONLY (164)

  @integration
  Scenario: Row policy holds inside a CTE
    Given the restricted identity carries tenant-a's valid key-hash context
    When it selects from a LangWatchQL table through a WITH clause
    Then no tenant-b row is reachable through the CTE

  @integration
  Scenario: Row policy holds across UNION ALL branches
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes a UNION ALL whose branches select from LangWatchQL tables
    Then no branch returns a tenant-b row

  @integration
  Scenario: Row policy holds on both sides of a JOIN
    Given the restricted identity carries tenant-a's valid key-hash context
    When it joins two LangWatchQL tables
    Then neither join side contributes a tenant-b row

  @integration
  Scenario: Row policy holds inside subqueries
    Given the restricted identity carries tenant-a's valid key-hash context
    When it executes queries using IN, EXISTS, and scalar subqueries over LangWatchQL tables
    Then no subquery position leaks a tenant-b row

  @integration
  Scenario: Shadowing or aliasing the key-map table name does not defeat the policy
    Given the restricted identity carries tenant-a's valid key-hash context
    When it names the key-map table as a CTE, or aliases another table as it
    Then only tenant-a rows are returned

  @integration
  Scenario: The merge table function is contained by the row policies
    Given the restricted identity carries tenant-a's valid key-hash context
    When it reads LangWatchQL tables through the merge table function
    Then only tenant-a rows are returned

  @integration
  Scenario: Table functions that read no data remain available
    Given the restricted identity carries tenant-a's valid key-hash context
    When it uses table functions that reach no stored data
    Then they are allowed, because they expose nothing to contain

  @integration
  Scenario: Only the granted objects are visible through the readable tables view
    Given the restricted identity carries tenant-a's valid key-hash context
    When it lists the tables it can see
    Then it sees exactly the objects it holds a grant on

  @integration
  Scenario: Every LangWatchQL object has an effective row policy
    Given the set of objects the restricted identity can read, taken from the server
    When each is checked for a row policy bound to that identity
    Then every object has one

  @integration
  Scenario: A definer-rights view bypasses the row policy and is reported by the audit
    Given a view over a LangWatchQL table created with definer rights
    When the restricted identity selects from it
    Then rows from both tenants are returned
    And the lwql-schema audit reports that view
    And the audit reports the database clean once the view is removed

  @integration
  Scenario: No dictionary in the LangWatchQL schema could serve the same data unpoliced
    Given the LangWatchQL schema's dictionaries
    When they are enumerated
    Then none is present, because dictionaries are not subject to row policies

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
    When it selects from a LangWatchQL table
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
  # The LangWatchQL analytics.* schema: the catalog and the views over the real
  # fact tables (bound in this PR — Testcontainers, the shipped ClickHouse
  # migrations applied, executing as the restricted user)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every LangWatchQL view declares its grain, join keys, and time column
    Given the LangWatchQL analytics schema catalog
    When each dataset is inspected
    Then it declares a grain, join keys, a freshness, and the column that prunes its partitions
    And every column it advertises is one the dataset exposes

  @unit
  Scenario: The gated column set is derived from the data privacy policy, not hand-listed
    Given the data privacy policy's content categories and their attribute keys
    When the LangWatchQL schema's gated columns are derived for a caller's permissions
    Then a column built over a content-carrying attribute key is gated exactly as that policy classifies it
    And no ungated column is built over a content-carrying key
    And a caller whose permissions are unresolved has every gated column withheld

  @unit
  Scenario: A pre-aggregated dataset declares that its rows merge rather than supersede
    Given the LangWatchQL analytics schema catalog
    When a dataset whose source aggregates is inspected
    Then it declares every key its rows merge on
    And it declares no version column, because no version supersedes another
    And a dataset whose source keeps versions still declares the column that picks the survivor

  @unit
  Scenario: The analytics-optimised datasets expose no captured content
    Given the LangWatchQL analytics schema catalog
    When the datasets built over the analytics projections are inspected
    Then none of them exposes a content-gated column
    And every attribute map any dataset exposes has the content keys filtered out

  @unit
  Scenario: A pre-aggregated dataset advertises its whole bucket key as its join keys
    Given the LangWatchQL analytics schema catalog
    When a dataset whose rows are pre-aggregated buckets is inspected
    Then every column of its bucket key is advertised as a join key
    And a dataset whose rows are records may still advertise a key it is not unique on

  @unit
  Scenario: A summed measure reads the column it is named after
    Given the LangWatchQL analytics schema catalog
    When a pre-aggregated measure is inspected
    Then it reads the column it is named after
    And it is read back as the numeric type the schema publishes for it
    And it cannot carry SQL of its own that says otherwise

  @unit
  Scenario: A dataset whose sort key moves declares the strategy that deduplicates it
    Given the LangWatchQL analytics schema catalog
    When a dataset whose source sorts by a column its write path moves is inspected
    Then it declares that one row is one record rather than one sort key
    And a dataset that declares a grain narrower than its engine's key declares a strategy that can deliver it
    And the datasets whose sort keys hold still keep the shipped default

  @integration
  Scenario: A pre-aggregated dataset returns one merged row per bucket
    Given a rollup table holding two partial rows for the same bucket
    And the restricted identity carries tenant-a's valid key-hash context
    When it reads that bucket through the LangWatchQL view
    Then one row is returned
    And every measure is the sum of its own column's partial rows

  @integration
  Scenario: A dataset whose sort key moves is deduplicated by its own identity
    Given a fact table holding two versions of one record under two different sort keys
    And the restricted identity carries tenant-a's valid key-hash context
    When it reads that record through the LangWatchQL view
    Then one row is returned
    And it carries the newer version's values

  @integration
  Scenario: Every LangWatchQL view's dedup declaration matches the table it reads
    Given the shipped ClickHouse migrations applied to the test server
    When each LangWatchQL view's declared keys are compared with its source table
    Then the declared keys are the columns that table sorts by
    And the declared merge behaviour is the engine that table uses

  @integration
  Scenario: The catalog's declared columns match the tables the views read
    Given the shipped ClickHouse migrations applied to the test server
    When the LangWatchQL schema catalog is compared with the created tables and views
    Then every column the catalog declares exists with the type it declares

  @integration
  Scenario: Every LangWatchQL view names the column that prunes its partitions
    Given the shipped ClickHouse migrations applied to the test server
    When each LangWatchQL view's advertised time column is compared with its source table's partitioning
    Then the advertised column is the one the table partitions by

  @integration
  Scenario: A LangWatchQL view returns only the calling tenant's rows
    Given the restricted identity carries tenant-a's valid key-hash context
    When it selects from each LangWatchQL view
    Then every returned row belongs to tenant-a
    And no row of tenant-b is returned

  @integration
  Scenario: A LangWatchQL view returns one row per logical record, the latest version
    Given a fact table holding two versions of the same record
    When the restricted identity selects that record through the LangWatchQL view
    Then one row is returned
    And it carries the newer version's values

  @integration
  Scenario: A column no LangWatchQL view exposes is unreachable, not merely unselected
    Given the restricted identity carries tenant-a's valid key-hash context
    When it references a column outside the LangWatchQL schema catalog
    Then the query is rejected by the database
    And a column the catalog does expose reads normally

  @integration
  Scenario: Captured content is reachable only through the gated columns
    Given seeded traces and spans whose attributes carry captured content
    And the restricted identity carries tenant-a's valid key-hash context
    When it reads the attribute maps a LangWatchQL view exposes
    Then no captured content is present in them
    And the same content is returned by the view's content-gated columns

  @integration
  Scenario: Reading the physical fact table directly is policed the same way
    Given the restricted identity carries tenant-a's valid key-hash context
    When it selects from the physical table a LangWatchQL view reads
    Then every returned row belongs to tenant-a

  @integration
  Scenario: Row policies leave the application's own reads untouched
    Given the LangWatchQL row policies applied to the fact tables
    When an administrative identity reads those tables
    Then rows of both tenants are returned

  @integration
  Scenario: A time predicate on a LangWatchQL view prunes partitions
    Given seeded fact rows spread across several weekly partitions
    And the restricted identity carries tenant-a's valid key-hash context
    When it selects from a LangWatchQL view with and without a predicate on the view's time column
    Then the filtered query reads substantially fewer rows than the unfiltered one

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
  Scenario: Empty key context yields zero rows from a PG-engine mapped table
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries an empty key-hash context
    When it selects from the mapped table
    Then zero rows are returned

  @integration
  Scenario: A column the approved view excludes is unreachable through the mapping
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the approved view omits a sensitive column
    When the restricted identity references that column
    Then the query fails, because the column is unreachable rather than merely unselected

  @integration
  Scenario: The row-policy predicate is not pushed down to PostgreSQL
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries a key-hash context matching no key-map entry
    When it selects from the mapped table
    Then zero rows are returned
    And the statement PostgreSQL received carries no tenant predicate
    And PostgreSQL was asked to scan the whole approved view

  @integration
  Scenario: A predicate in the submitted SQL is pushed down to PostgreSQL
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries tenant-a's valid key-hash context
    When its SQL carries a predicate on the mapped table
    Then the statement PostgreSQL received carries that predicate

  @integration
  Scenario: Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries tenant-a's valid key-hash context
    When it queries the mapped table through CTE, UNION ALL, JOIN, and subquery shapes
    Then no shape leaks a tenant-b row from the mapped table

  @integration
  Scenario: Every PostgreSQL-resident dataset in the catalog is tenant-scoped
    Given the PostgreSQL-resident half of the LangWatchQL catalog is mapped into ClickHouse
    And the restricted identity carries tenant-a's valid key-hash context
    When it reads each mapped dataset in turn
    Then every dataset returns the caller's tenant rows and no other tenant's

  @integration
  Scenario: The LangWatchQL view sends a tenant predicate PostgreSQL can use
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    And the restricted identity carries tenant-a's valid key-hash context
    When it reads the LangWatchQL view over the mapped table
    Then the statement PostgreSQL received carries a predicate naming the caller's tenant
    And it names no other tenant and carries no API key

  @integration
  Scenario: The LangWatchQL view bounds what PostgreSQL reads to the caller's tenant
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    When the same question is asked of the mapped table and of the LangWatchQL view over it
    Then PostgreSQL reads fewer rows for the LangWatchQL view than for the mapped table
    And a key-hash context matching no key-map entry makes PostgreSQL read nothing

  @integration
  Scenario: A wrong tenant predicate costs a wrong read and never a wrong answer
    Given a LangWatchQL view whose tenant predicate names a tenant other than the caller's
    And the restricted identity carries tenant-a's valid key-hash context
    When it reads that view
    Then the statement PostgreSQL received carries the foreign tenant's predicate
    And PostgreSQL read those foreign rows
    And the caller receives zero rows, because the row policy decides the answer

  @integration
  Scenario: A duplicate key-map row does not break a PostgreSQL-resident read
    Given the key map holds two rows carrying the caller's key hash
    And the restricted identity carries tenant-a's valid key-hash context
    When it reads a PostgreSQL-resident LangWatchQL view
    Then it receives its own tenant's rows
    And the read is not rejected for returning more than one tenant

  @integration
  Scenario: The dedicated PG role is bounded by a statement timeout and a connection cap
    Given the dedicated PostgreSQL role the named collection connects as
    When its statement timeout and connection limit are read back from the server
    Then both are set, and a query that outruns the timeout is cancelled

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

  @unit
  Scenario: Every approved view is named under the prefix the reader's grants match
    Given the reader role's SELECT grants are provisioned by matching approved view names against the lwql_ prefix
    When the approved views the catalog declares are read
    Then every one of them is named under that prefix
    And every view statement the provisioner emits creates a view under that prefix
    And a view named outside it would be created without a grant, and so read as empty rather than fail

  @integration
  Scenario: PG connection credentials are not exposed to the restricted identity
    Given a PG-resident table is mapped into ClickHouse through the server-side named collection
    When the restricted identity inspects the mapped table's definition and the server's named collections
    Then no PostgreSQL credential is revealed

  # ---------------------------------------------------------------------------
  # Public API (bound in this PR — the shipped REST endpoint)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Authenticated client discovers its LangWatchQL schema scoped to its own permissions
    Given an authenticated API client
    When it calls the schema discovery endpoint
    Then it receives the LangWatchQL analytics datasets with descriptions, types, units, grain, freshness, allowed joins, content restrictions, and example SQL
    And datasets outside its permissions are absent

  @integration
  Scenario: The schema endpoint names which permission unlocks each gated column
    Given an authenticated API client without every content permission
    When it calls the schema discovery endpoint
    Then a column it may not read is still listed, marked unavailable
    And the column names the permission kinds that would unlock it, rather than a bare refusal
    And a caller holding every permission is refused no column

  @integration
  Scenario: Client executes native ClickHouse SQL through the documented REST endpoint
    Given an authenticated API client
    When it submits native ClickHouse SQL using joins, window functions, comparisons, percentiles, aliases, math, CTEs, and subqueries
    Then the query executes and returns tabular results

  @integration
  Scenario: Results carry typed columns, rows, execution statistics, truncation state, and diagnostics
    Given an authenticated API client
    When it executes a LangWatchQL query
    Then the response contains typed columns, rows, execution statistics, truncation state, and structured diagnostics

  @integration
  Scenario: Parameterized queries re-run deterministically through the REST API
    Given an authenticated API client
    When it re-submits the same parameterized query with the same bound parameters
    Then the result is identical across runs over unchanged data

  @integration
  Scenario: A query naming a column that does not exist is refused with the column named
    Given an authenticated API client
    When it submits a query selecting a column no dataset carries
    Then the query is refused with error code lwql_unknown_identifier at HTTP 400
    And the response names the column the server could not resolve
    And the fault is the caller's, and the remediation tells them to check the name against the dataset's columns
    And no part of the server's own refusal text reaches the caller, because it echoes the submitted query

  @integration
  Scenario: A parameterized query missing a bound value is refused before execution
    Given an authenticated API client
    When it submits a parameterized query without a value for one of its parameters
    Then the query is refused with error code lwql_parameter_missing at HTTP 400
    And the response names every parameter the SQL declares that the request left unset
    And the fault is the caller's, and the remediation tells them to send a value for each declared parameter
    And the query never reaches the database

  # ---------------------------------------------------------------------------
  # Answerable-question coverage (bound in this PR — the shipped endpoint,
  # Testcontainers ClickHouse carrying the shipped migrations and views)
  # Each case is fixture-backed with at least two tenants, only the
  # authenticated tenant contributing, asserted through the public gateway.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Latency percentiles by model in time buckets
    Given seeded traces for two tenants
    When the client asks for p50, p95, and p99 latency by model in time buckets
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Error rate versus the previous equivalent period
    Given seeded traces for two tenants spanning two periods
    When the client compares error rate against the previous equivalent period
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Rolling windows over trace metrics
    Given seeded traces for two tenants
    When the client computes a one-hour rolling error rate
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Cost by project, model, and prompt version
    Given seeded traces carrying cost, model and prompt version for two tenants
    When the client aggregates cost by project, model, and prompt version
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Cost attributed to dimension names rather than identifiers
    Given seeded generations and dimension data for two tenants
    When the client aggregates cost by project, model, and prompt-version names through dimension joins
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Token and cost outliers
    Given seeded traces with token and cost rollups for two tenants
    When the client asks for token and cost outliers
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Evaluation score distributions and pass rates by model and prompt version
    Given seeded evaluations for two tenants
    When the client asks for score distributions and pass rates by model and prompt version
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Annotation-versus-evaluation agreement
    Given seeded annotations and evaluations for two tenants
    When the client asks how often human thumbs agree with evaluator pass results
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Traces containing operation A then operation B
    Given seeded traces with ordered spans for two tenants
    When the client asks for traces where operation A precedes operation B
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Time between two events in a trace
    Given seeded traces with ordered spans for two tenants
    When the client asks for the elapsed time between two named events per trace
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: First failure and first retry per trace
    Given seeded traces with failures and retries for two tenants
    When the client asks for the first failure and first retry per trace
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Run comparisons across simulation batches
    Given seeded simulation runs for two tenants across two batches
    When the client compares verdict and duration metrics across those batches
    Then typed results answer the question from the authenticated tenant's data only

  # @unimplemented — https://github.com/langwatch/langwatch/issues/7334. The
  # PostgreSQL-resident dataset that bound this was removed in #7194: its
  # declared grain named a run id `BatchEvaluation` does not have, and its base
  # relation is written only by the legacy evaluate route, so it answered this
  # from a subset while the real experiment runs live in ClickHouse. Rebinds
  # against a ClickHouse-resident dataset.
  @unimplemented
  Scenario: Experiment run comparisons
    Given seeded experiment runs for two tenants
    When the client compares metrics across experiment runs
    Then typed results answer the question from the authenticated tenant's data only

  @integration
  Scenario: Fanout warning on a trace-to-span join
    Given seeded traces and spans for two tenants
    When the client aggregates at trace grain after joining spans
    Then the response carries a POSSIBLE_FANOUT diagnostic naming the affected columns with evidence

  # ---------------------------------------------------------------------------
  # Tenant isolation and authorization at the gateway (bound in this PR — the
  # shipped REST endpoint)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Tenant scope derives exclusively from authenticated server context
    Given an authenticated API client
    When it attempts to supply, override, inspect, or widen tenant scope via SQL text or request parameters
    Then the attempt is rejected or ignored and only the authenticated tenant's data is reachable

  @integration
  Scenario: Content-gated fields are refused in every expression position
    Given an authenticated API client without content permissions
    When it references a content-gated field in projection, filter, group, order, having, join, window, or subquery position
    Then the query is rejected with error code lwql_not_permitted at HTTP 400
    And every refusal names the GATED_COLUMN rule, so the caller learns which field to drop
    And the fault is the caller's, and the remediation points them at the fields the schema endpoint lists for their key
    And the gated-field set matches the canonical visibility policy

  @integration
  Scenario: A dataset withheld from a caller cannot be named in a query
    Given an authenticated API client whose permissions withhold a whole dataset
    When it names that dataset in a query
    Then the query is rejected before it reaches the database
    And a caller holding the permission reads the same dataset normally

  # ---------------------------------------------------------------------------
  # Read-only, exfiltration, and fail-closed behavior at the gateway
  # (bound in this PR except the @unimplemented fail-closed wiring; the
  # database-identity half is bound above)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: External and table-function access is blocked by AST policy before reaching the database
    Given an authenticated API client
    When it submits SQL using postgresql, url, s3, remote, or any table function
    Then the gateway rejects the query by AST policy with error code lwql_not_permitted at HTTP 400
    And every refusal names the TABLE_FUNCTION rule, which a rejection by the database could not produce
    And the fault is the caller's, and the remediation tells them to read only the datasets the schema endpoint lists

  @unit
  Scenario: Only the functions a LangWatchQL question needs can be called
    Given the LangWatchQL analytics SQL policy
    When a query calls a function outside the set the LangWatchQL questions need
    Then the query is refused before it reaches the database
    And the refusal names the FUNCTION_NOT_ALLOWED rule and the function it refused, so the caller knows what to change
    And the boundary carries it as error code lwql_not_permitted, a caller fault
    And the functions those questions are written in are accepted

  @integration
  Scenario: Query database credentials never reach the caller
    Given an authenticated API client
    When any LangWatchQL query succeeds or fails
    Then no response or error ever contains database credentials, server settings, physical internal table names, or another tenant's existence

  # @unimplemented: fail-closed wiring lands with the query endpoint PR of #6480.
  @integration @unimplemented
  Scenario: Missing parser, restricted identity, or row policy fails closed
    Given the parser, the restricted identity, or the row-policy setup is unavailable
    When a client submits a LangWatchQL query
    Then the query is rejected rather than executed with weaker guarantees

  # ---------------------------------------------------------------------------
  # Resource safety (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: resource governance lands with the executor PR of #6480.
  @integration @unimplemented
  Scenario: Database-enforced ceilings bound every resource dimension
    Given the LangWatchQL execution profile
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
  # Diagnostics (bound in this PR — advisory, never a refusal)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Truncation diagnostic fires when results are cut off
    Given an authenticated API client
    When a query's results are truncated by the result-size limit
    Then the response marks truncation explicitly

  @integration
  Scenario: Incomplete or misaligned comparison period diagnostic fires
    Given an authenticated API client
    When a query compares periods of unequal or incomplete coverage
    Then the response carries the comparison-period diagnostic

  @integration
  Scenario: Missing time buckets diagnostic fires
    Given an authenticated API client
    When a time-bucketed query has empty buckets in range
    Then the response carries the missing-time-buckets diagnostic

  @integration
  Scenario: An unbounded read is reported as covering the whole history
    Given an authenticated API client
    When it queries a dataset with no condition on the column that prunes its partitions
    Then the response carries the unbounded-time-range diagnostic naming that column
    And the same question with that condition carries no diagnostic

  @unit
  Scenario: Clean diagnostic status is documented as no known issue detected
    Given the diagnostics documentation
    When the clean status is described
    Then it reads as "no known issue detected" and never as proof of correctness

  # ---------------------------------------------------------------------------
  # Reaching PostgreSQL-resident data: decision end-state (later PR of this issue — #6480)
  # ---------------------------------------------------------------------------

  # @unimplemented: no mapped table has failed the measured bar, so there is no
  # projection fallback to exercise. The measurement itself is bound — see
  # "The LangWatchQL view bounds what PostgreSQL reads to the caller's tenant" —
  # and this stays unbound until a table's numbers actually trigger a fallback.
  @integration @unimplemented
  Scenario: A PG-resident table that fails the measured bar is served via projection instead
    Given per-table p95 latency and load-on-primary measurements recorded for each PG-resident table
    When a table fails the measured bar
    Then that table is served from a ClickHouse projection
    And the fallback is documented per table

  # @unimplemented: annotations ship PG-direct, and the LangWatchQL schema now has
  # exactly one annotation source. The second half is not done: the
  # `trace_summaries.AnnotationIds` column still backs the product's own
  # has-annotation filter, so it is neither removed nor widened. Removing it is
  # a product change beyond the LangWatchQL schema and lands with its own slice.
  @integration @unimplemented
  Scenario: Annotation data has exactly one source at ship time
    Given the shipped annotations mechanism
    When annotation data is queried through the LangWatchQL schema
    Then it comes from exactly one source
    And the partial AnnotationIds projection is either removed or widened, not left half-done

  # ---------------------------------------------------------------------------
  # Non-goals held as scope guards (bound in this PR)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: No PostgreSQL native-SQL execution endpoint exists
    Given the public API surface
    When a client attempts to execute SQL against a PostgreSQL query endpoint
    Then no such endpoint exists

  @unit
  Scenario: No custom query language and no new BI platform dependency ships
    Given the application's dependency manifest and source tree
    When inspected for a custom query grammar, compiler, IR, or a Cube or Trino dependency
    Then none is present

  @integration
  Scenario: Submitted SQL is never automatically rewritten
    Given an authenticated API client
    When it submits a LangWatchQL query
    Then the SQL the database executes is the submitted statement, not a rewritten one
    And no UI or natural-language translation layer is involved

  @unit
  Scenario: The table-function and SSRF policy is captured as an ADR
    Given the repository's ADR index
    When the table-function and SSRF policy is looked up
    Then a dedicated ADR documents why user-supplied table functions remain blocked via AST and grants

  # --- Self-provisioning and cluster topology ---
  # Chart-managed ClickHouse self-provisioning (issue #7331)

  @e2e
  Scenario: A ClickHouse mode transition rolls the application automatically
    Given the chart is rendered with chart-managed ClickHouse at one replica and at three replicas
    Then the application pod template differs between the two renders

  # Design C: whoever owns the ClickHouse server owns the access model. The app
  # self-provisions ONLY when it owns nothing else — external/BYO ClickHouse. For
  # chart-managed ClickHouse the owning pod renders the access model as config, so
  # the app must not also run the provisioning DDL (one owner per entity name).
  @e2e
  Scenario: App self-provisioning is exclusive to external ClickHouse under Design C
    Given the chart is rendered once with chart-managed ClickHouse and once with external ClickHouse
    Then the application carries the LangWatchQL self-provisioning environment variable only in the external-ClickHouse render
    And the chart-managed render leaves provisioning to the ClickHouse server that owns the access model

  @e2e
  Scenario: A single-replica deployment provisions LangWatchQL unchanged
    Given the chart is installed with chart-managed ClickHouse at one replica
    Then the ClickHouse server starts
    And the restricted identity, its row policies and its named collection all exist

  @e2e @unimplemented
  Scenario: Clustered chart-managed ClickHouse provisions the full LangWatchQL access model
    Given the chart is installed with chart-managed ClickHouse at three replicas
    When the application boots
    Then the restricted identity, its settings profile, its grants, its row policies, its named collection and its engine tables all exist
    # Tracking issue #7387 — covering test coming in follow-up batch

  @integration
  Scenario: Provisioning does not alter the migrated database
    Given the ClickHouse migrations have created the application database
    When LangWatchQL provisioning runs
    Then the database engine is unchanged
    And provisioning against a database name that differs from the connection URL's is refused

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
# LangWatchQL schema (the analytics.* catalog and the views over the fact tables):
# AC "Expose a stable analytics.* namespace; every exposed dataset declares grain,
#     join keys, sensitivity, freshness"
#   → Scenario: Every LangWatchQL view declares its grain, join keys, and time column
#   → Scenario: The catalog's declared columns match the tables the views read
#   → Scenario: Every LangWatchQL view names the column that prunes its partitions
#   → Scenario: A pre-aggregated dataset declares that its rows merge rather than supersede
#     (issue #6856: the analytics projections and their per-minute rollups join
#      the catalog, and a rollup's source is an AggregatingMergeTree — its rows
#      for one key are SUMMED rather than superseded, which is a third answer to
#      "which row survives" and cannot be inferred from the other two)
#   → Scenario: A pre-aggregated dataset returns one merged row per bucket
#     (the same claim proven against the shipped table: partial rows in
#      separate parts, one summed row out, every measure read back against a
#      total no other measure shares — a bucket whose measures share a value
#      cannot tell a mislabelled measure from a correct one)
#   → Scenario: A summed measure reads the column it is named after
#     (the declaration is single-sourced: name, published type and "this is a
#      sum" are stated once and the SQL is derived, because a cast returns a
#      number whatever column it reads)
#   → Scenario: A pre-aggregated dataset advertises its whole bucket key as its join keys
#     (every column of a bucket is a sum, so a join matching part of the key
#      adds several buckets together rather than repeating a row)
#   → Scenario: A dataset whose sort key moves declares the strategy that deduplicates it
#   → Scenario: A dataset whose sort key moves is deduplicated by its own identity
#     (evaluation_analytics folds a moving watermark into OccurredAt, which is
#      part of its sort key, so FINAL keeps every lifecycle version and every
#      aggregate counts the evaluation once per version)
#   → Scenario: Every LangWatchQL view's dedup declaration matches the table it reads
#     (the rule the catalog states and nothing enforced: the declared keys are
#      the source's sort key, and the declared merge behaviour is its engine)
# AC "Derive content-gated fields from the existing visibility stack — never a second
#     handwritten gated-field list; keep a parity test"
#   → Scenario: The gated column set is derived from the data privacy policy, not hand-listed
#   → Scenario: Captured content is reachable only through the gated columns
#   → Scenario: The analytics-optimised datasets expose no captured content
#     (issue #6856: the analytics projections carry no captured input or output
#      at all, and every attribute map in the catalog is filtered against the
#      same policy — the map is the one place a view can leak content without
#      naming a gated column)
# (supporting invariants of the same proof: the views are bounded by the same row
#  policies as the tables under them, the grant is the exposed surface, and the
#  views are usable at scale)
#   → Scenario: A LangWatchQL view returns only the calling tenant's rows
#   → Scenario: A LangWatchQL view returns one row per logical record, the latest version
#   → Scenario: A column no LangWatchQL view exposes is unreachable, not merely unselected
#   → Scenario: Reading the physical fact table directly is policed the same way
#   → Scenario: Row policies leave the application's own reads untouched
#   → Scenario: A time predicate on a LangWatchQL view prunes partitions
#
# Product:
# AC "schema discovery scoped to own permissions"
#   → Scenario: Authenticated client discovers its LangWatchQL schema scoped to its own permissions
#     (the catalog carries a per-column unit and a dataset-level gate; a dataset
#      the caller can read nothing in is absent rather than listed-and-refused)
#   → Scenario: The schema endpoint names which permission unlocks each gated column
#     (per-column gate kinds, not a collapsed boolean)
# AC "execute native ClickHouse SQL via REST" → Scenario: Client executes native ClickHouse SQL through the documented REST endpoint
# AC "typed columns, rows, stats, truncation, diagnostics" → Scenario: Results carry typed columns, rows, execution statistics, truncation state, and diagnostics
# AC "parameterized queries re-run deterministically"
#   → Scenario: Parameterized queries re-run deterministically through the REST API
#   → Scenario: A parameterized query missing a bound value is refused before execution
#     (the failure path of the same feature, refused at the gateway)
#
# Answerable-question coverage (one scenario each, same titles in order). Each
# bound case asserts the value its seed implies — the percentile, the rate, the
# sum — against a second tenant seeded in the same window, so "only the
# authenticated tenant contributed" is proven by the number itself:
# p50/p95/p99 → Latency percentiles by model in time buckets
# error rate vs previous period → Error rate versus the previous equivalent period
# rolling windows → Rolling windows over trace metrics
# cost by project/model/prompt-version → Cost by project, model, and prompt version via dimension joins by name
#   → Scenario: Cost by project, model, and prompt version (by identifier)
#   → Scenario: Cost attributed to dimension names rather than identifiers
#     (the by-NAME half joins the PostgreSQL-resident project and prompt
#      dimensions; the model is already a name on the fact table, so nothing is
#      mapped to resolve it)
# token/cost outliers → Token and cost outliers
# evaluation distributions/pass rates → Evaluation score distributions and pass rates by model and prompt version
# annotation-vs-evaluation agreement → Annotation-versus-evaluation agreement
#   (two cases: the agreement rate itself, and the isolation half stated
#    separately because the aggregate would have the same shape if the other
#    tenant's annotations had joined in)
# A then B → Traces containing operation A then operation B
# time between events → Time between two events in a trace
# first failure/retry → First failure and first retry per trace
# experiment comparisons → Experiment run comparisons
#   → Scenario: Run comparisons across simulation batches
#     (the run grouping ClickHouse holds)
#   → Scenario: Experiment run comparisons
#     (the experiment-shaped comparison — @unimplemented, awaiting a
#      ClickHouse-resident experiment-runs dataset, issue #7334)
# fanout warning → Fanout warning on a trace-to-span join
#
# Tenant isolation and authorization:
# AC "scope derived exclusively from server context" → Scenario: Tenant scope derives exclusively from authenticated server context
# AC "row policies independently prevent cross-tenant reads, verified against the restricted identity"
#   → the bound isolation-proof scenarios (baseline + CTE/UNION/JOIN/subquery above)
# AC "content-gated fields refused in every expression position" → Scenario: Content-gated fields are refused in every expression position
#   → Scenario: A dataset withheld from a caller cannot be named in a query
#     (the dataset-level half of the same gate: absent from the published schema
#      is not the same as out of reach, and the validator's allowed-table set is
#      what makes it the second thing)
# AC "row-policy + zero-rows-on-garbage-key on PG-engine mapped tables (PG container)"
#   → Scenario: A PG-resident table is readable through ClickHouse only within the caller's tenant rows
#   → Scenario: Garbage key context yields zero rows from a PG-engine mapped table
#   → Scenario: Row policy on a PG-engine mapped table holds under CTE, UNION, JOIN, and subquery shapes
#   → Scenario: Every PostgreSQL-resident dataset in the catalog is tenant-scoped
#     ("for every table still served via the named collection at ship time":
#      the case iterates the shipped catalog rather than naming one table, so a
#      dataset added without a policy fails it with no test edit)
#
# Reaching PostgreSQL-resident data:
# AC "per-table latency + load measurements recorded before projections" → recorded in the
#    PG-mapping PR (process AC); the load half is measured on every run by:
#   → Scenario: The row-policy predicate is not pushed down to PostgreSQL
#     (the finding: a policy predicate never reaches the primary, in any form)
#   → Scenario: The LangWatchQL view sends a tenant predicate PostgreSQL can use
#   → Scenario: The LangWatchQL view bounds what PostgreSQL reads to the caller's tenant
#     (rows off the primary, from PostgreSQL's own accounting — the number the
#      projection-fallback decision turns on)
#   → Scenario: A wrong tenant predicate costs a wrong read and never a wrong answer
#     (what makes the predicate a performance control rather than a second
#      security boundary: get it wrong and the row policy still decides)
#   → Scenario: The dedicated PG role is bounded by a statement timeout and a connection cap
# AC "failing tables fall back to projection, documented"
#   → Scenario: A PG-resident table that fails the measured bar is served via projection instead
#     (still @unimplemented: no mapped table has failed the bar, so no fallback
#      exists to exercise — see the note above the scenario)
# AC "AnnotationIds partial projection resolved one way" → Scenario: Annotation data has exactly one source at ship time
#   (still @unimplemented: the LangWatchQL schema now has a single annotation
#    source, but `trace_summaries.AnnotationIds` still backs the product's own
#    has-annotation filter, so the projection itself is neither removed nor
#    widened — see the note above the scenario)
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
#   → Scenario: Only the functions a LangWatchQL question needs can be called
#     (the name allowlist beside the positional table-function rule: a function
#      is listed because a LangWatchQL question needs it, never because it looks harmless)
# AC "credentials never reach the caller"
#   → Scenario: PG connection credentials are not exposed to the restricted identity
#   → Scenario: Query database credentials never reach the caller
#     (both directions — never volunteered, and refused when asked for outright,
#      which is what the function allowlist made true)
# AC "missing parser/identity/policy fails closed" → Scenario: Missing parser, restricted identity, or row policy fails closed
#
# Resource safety:
# AC "database-enforced ceilings" → Scenario: Database-enforced ceilings bound every resource dimension
#   (the settings profile pins readonly, max_execution_time and max_memory_usage CONST;
#    the endpoint adds row and byte ceilings on what is returned, and can relax neither)
# AC "pathological join contained; no tenant monopoly" → Scenario: A pathological join is contained within its resource envelope
# AC "overflow throws, never silent truncation" → Scenario: Overflow throws and never silently truncates
#   (the never-SILENT half ships and is bound by the truncation scenario below; the
#    throws-on-a-database-ceiling half needs a deterministic way to exhaust one)
#
# Diagnostics:
# AC "four rules, each fixture-triggered"
#   → Scenario: Fanout warning on a trace-to-span join (POSSIBLE_FANOUT)
#   → Scenario: Truncation diagnostic fires when results are cut off (RESULT_TRUNCATED)
#   → Scenario: Incomplete or misaligned comparison period diagnostic fires (INCOMPLETE_COMPARISON_PERIOD)
#   → Scenario: Missing time buckets diagnostic fires (MISSING_TIME_BUCKETS)
# AC "clean = no known issue detected" → Scenario: Clean diagnostic status is documented as no known issue detected
# (a fifth rule beyond the four the issue scopes, because the partition-pruning
#  measurement recorded in src/server/analytics/lwql/views.ts puts an
#  eight-fold read cost on the shape it reports)
#   → Scenario: An unbounded read is reported as covering the whole history (UNBOUNDED_TIME_RANGE)
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
#   → Scenario: Every approved view is named under the prefix the reader's grants match
