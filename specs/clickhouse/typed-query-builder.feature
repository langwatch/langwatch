Feature: A typed ClickHouse read builder renders the tenant predicate and the tenant setting from one scope

  As a repository reading tenant rows from ClickHouse
  I want to build a read from a required tenant scope and typed table descriptors
  So that the tenant predicate, the bound values and the row policy's tenant setting cannot disagree

  ADR-202, "The typed builder" and Decided 7 and 9: hand-written in packages/clickhouse-client,
  shared and braid windows, braid conditions and the held-trace semi-join stay in the builder.
  The builder only builds a statement; the client sends it. The fence's renderer is reused by
  import, so a fenced read and its built equivalent render the same text.

  # ---------------------------------------------------------------------------
  # Scopes
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A read without a tenant scope does not type-check
    Given a repository building a read
    When it calls the builder without a scope
    Then the call does not type-check
    And a scope missing at run time is refused before any text is rendered

  @unit
  Scenario: A single-tenant read binds its tenant as a parameter and as the tenant setting
    Given a read scoped to one tenant
    When it is built
    Then the tenant predicate binds the tenant as a named parameter
    And "SQL_langwatch_tenant_ids" names that tenant alone
    And the statement goes out on the reader identity

  @unit
  Scenario: A tenant-set read binds the set and names every member in the tenant setting
    Given a read scoped to a set of tenants
    When it is built
    Then the tenant predicate binds the set as one array parameter
    And "SQL_langwatch_tenant_ids" lists the same tenants comma-separated

  @unit
  Scenario: A tenant set that could widen the tenant setting is refused
    Given a tenant set that is empty, or a tenant id that is empty or carries a comma
    When the scope is built
    Then it is refused by name

  @unit
  Scenario: A proof-scoped read takes the fence's tenants for the predicate and the setting alike
    Given a proof with own projects and a shared window
    When a read scoped from it is built within its windows
    Then the tenant predicate is the fence the proof allows
    And "SQL_langwatch_tenant_ids" lists exactly the tenants the fence binds

  @unit
  Scenario: An all-tenants read goes out on the system identity and carries no tenant setting
    Given a read scoped to all tenants with a stated reason
    When it is built
    Then the statement names the system identity
    And it carries no tenant predicate and no "SQL_langwatch_tenant_ids"

  @unit
  Scenario: An all-tenants read is refused on the reader identity
    Given a read scoped to all tenants
    When it is handed to a path that sends only on the reader identity
    Then that hand-off does not type-check
    And at run time it is refused by name

  # ---------------------------------------------------------------------------
  # Tables and values
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A column the table does not declare does not type-check
    Given a table descriptor declaring its columns
    When a read names a column the descriptor does not declare, or a column of a table outside the read
    Then the read does not type-check
    And a column of a table outside the read is refused at run time

  @unit
  Scenario: Every value is a named parameter and the only text escape is a reviewed fragment
    Given a read comparing columns with caller values
    When it is built
    Then every value is bound as a named parameter, never written into the text
    And a fragment renders only text from the reviewed allow-list, none of which names a tenant

  @unit
  Scenario: An alias named after a column the read declares is refused
    Given a read selecting a value under the name of another declared column
    When it is built
    Then it is refused as a shadowing alias

  # ---------------------------------------------------------------------------
  # The fence's features as builder operations
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A proof-scoped read that names no window treatment is refused
    Given a read scoped from a proof
    When it is built without "withinWindows" or "braided"
    Then it is refused as a read whose shared windows would never apply

  @unit
  Scenario: A braided read applies each braid's condition under the held-trace semi-join
    Given a proof carrying a braid on a span read
    When the read is built braided, narrowed to one held trace
    Then it renders the conditions the fence renders for that proof
    And building it within plain windows instead is refused

  @unit
  Scenario: The latest version is elected inside the same fence
    Given a read over a table declaring a version column
    When it asks for the latest version
    Then it renders the key-and-version election under the fence's latest-version form
    And the election repeats the read's key and time filters and nothing else

  @unit
  Scenario: The latest-version election keeps the read's time window
    Given a read over a table declaring a version column and a time column
    When it filters on the time column and asks for the latest version
    Then the election repeats the time filter, so it prunes the same partitions

  @unit
  Scenario: FINAL is refused on a table whose sort key does not hold its tenant column
    Given a table whose sort key holds its tenant column
    When a read asks for FINAL
    Then it reads the table with FINAL
    And the same request on a table whose sort key lacks its tenant column is refused

  @unit
  Scenario: A join scopes both sides and equates their tenants
    Given a read joining two tenant tables
    When it is built
    Then each side reads under its own tenant predicate
    And the join condition equates the two sides' tenant columns

  @unit
  Scenario: A common table expression and a UNION ALL arm inherit the read's scope
    Given a read with a common table expression and a UNION ALL arm
    When it is built
    Then every select in the statement carries the read's tenant predicate
    And a UNION ALL arm is rendered in the read's column order

  @unit
  Scenario: The builder renders what the fence renders for an equivalent fenced read
    Given three fenced reads: a windowed read, a braided read electing its latest version, and a read through a common table expression
    When each is built and its marker form is expanded by the fence
    Then the statement text and the bound parameters are equal

  # ---------------------------------------------------------------------------
  # The shapes the repositories issue (rp-b2 census)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A read calls only catalogued functions, binding every value
    Given a read selecting aggregates, conditional aggregates, date buckets and tuple comparisons
    When it is built
    Then each call is a function from the builder's catalogue
    And every value it passes is a named parameter bound by the function's signature
    And a constant the grammar needs as text, such as a quantile level, is refused out of bounds

  @unit
  Scenario: PREWHERE, HAVING, DISTINCT and LIMIT BY render in their clauses
    Given a read with PREWHERE conditions, a grouping with HAVING, or DISTINCT with LIMIT BY
    When it is built
    Then each renders in its own clause and the tenant predicate stays in WHERE
    And PREWHERE on a join is refused

  @unit
  Scenario: The IN-tuple election renders in WHERE, in PREWHERE or inside a join side
    Given a read asking for the latest version on its table or on a joined table
    When it is built
    Then the election reads keys and the version under the same scope
    And on a join each side elects inside its own scoped subquery

  @unit
  Scenario: A DateTime64 column is a member of bound epoch milliseconds
    Given a read testing a DateTime64 column against a list of epoch milliseconds
    When it is built
    Then the column is compared as epoch milliseconds against one bound array

  @unit
  Scenario: A derived table is read under its own scope and carries the predicate inside
    Given a read selecting from another read used as a table
    When it is built
    Then the inner read carries the tenant predicate and the outer read adds none
    And a derived table built under another scope is refused

  @unit
  Scenario: A self-join aliases one side and qualifies fragments by their side
    Given a read joining a table to an alias of itself and reading a reviewed fragment on each side
    When it is built
    Then each side is its own scoped subquery under its own name
    And each fragment's columns are qualified by the side it names
    And joining a table to itself without an alias is refused

  @unit
  Scenario: An ordered or limited UNION ALL orders the whole union
    Given a UNION ALL read ordered and limited, with an arm carrying its own WITH, order and limit
    When it is built
    Then the union is wrapped so its order and limit cover every arm
    And the arm is parenthesised with its own clauses
    And ordering a union by an expression rather than a selected key is refused

  @unit
  Scenario: A read by id carries the id index marker the client expands
    Given a read filtering on one id, or on a composite id
    When it is built
    Then the equality carries the id index marker naming its table, keys and parameters
    And the marker on a join read is refused

  @integration
  Scenario: Built statements return their tenant's rows under the reader's row policy on 26.8
    Given ClickHouse 26.8 with a reader whose row policy reads the tenant setting
    When join, common table expression, UNION ALL, FINAL, latest-version, derived, windowed and braided reads are built and sent
    Then each returns exactly its tenant's rows
    And each keeps another tenant's rows out by its own text when the setting lists every tenant
    And a statement sent under another tenant's setting returns no rows

  # ---------------------------------------------------------------------------
  # Server metadata
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A server-metadata read names only the allow-listed system tables
    Given a server-metadata scope stating its reason
    When it reads system.columns, system.replicas or system.server_settings, or no table at all
    Then the statement goes out on the reader identity as a metadata statement
    And it carries no tenant setting and no tenant predicate

  @unit
  Scenario: A server-metadata read naming any other table is refused
    Given a server-metadata scope
    When it names an app table, or a system table off the allow-list such as query_log, processes, mutations, query_views_log, text_log, parts or disks
    Then the read does not type-check
    And it is refused at run time
    And a tenant scope naming an allow-listed system table is refused the same way

  @integration
  Scenario: A server-metadata read runs on 26.8 with no tenant setting
    Given ClickHouse 26.8 and the reader identity
    When a server-metadata read of system.columns and a table-less read are built and sent
    Then both return their rows without a tenant setting

  @unit
  Scenario: A read sets its own query-level settings but never the scope's
    Given a single-tenant read that sets max_execution_time, timeout_overflow_mode and max_threads
    When it is built
    Then its SQL ends with a SETTINGS clause naming them, and its statement settings are still the pinned settings and the tenant setting
    And a SQL_ key, a pinned key, a value that is not a finite number or a plain word, or settings on a union are refused by code

  @unit
  Scenario: A descriptor declares nested columns and every column type the migrations declare
    Given descriptors with nested columns such as "Messages.Id" and the array, map, tuple, LowCardinality, SimpleAggregateFunction, AggregateFunction, FixedString, Decimal, DateTime and Int8 types the migrations declare
    When reads over them are built
    Then each type writes the ClickHouse text its migration declares
    And a nested column is backquoted, qualified by its table in a join, and a member tested against an array or a map binds as the member's own type
    And a value compared with a wrapped type binds as the type it wraps

  @unit
  Scenario: An AggregateFunction state is read only through its merge function
    Given a rollup whose columns are AggregateFunction states
    When a read merges them with argMaxMerge, sumMerge and countMerge
    Then each renders its -Merge function and types the merged value as the state's result
    And a merge of another function's state, or a bound value compared with a state, does not compile

  @unit
  Scenario: A lambda's parameters are named by the builder and typed by the arrays it reads
    Given a read that calls arrayMap, arrayFilter, arrayExists, arrayReverseSort and mapFilter with lambdas, one nested in another
    When it is built
    Then each lambda parameter takes a name the builder gives it, distinct across nested lambdas, and is typed by the array it ranges over
    And a parameter read outside its lambda is refused by code

  @unit
  Scenario: The census functions render with every value bound
    Given a read calling the JSON, string, date, array and parameterised aggregate functions the second census found
    When it is built
    Then every JSON key, pattern, replacement, format, unit and time zone is a bound value
    And a constant the grammar needs as text is checked inside its bounds or the build is refused by code

  @unit
  Scenario: A CAST names its type by a column type checked against the type grammar
    Given a read selecting a typed NULL, a typed empty array and a conversion
    When it is built
    Then each CAST writes the column type's ClickHouse text
    And a type whose text is not a type name with type or integer arguments, or a NULL or empty array of a type that cannot hold one, is refused by code

  @unit
  Scenario: A per-target select list reads the held column or its typed default
    Given a read selecting columns a pending ClickHouse step adds, and what the target holds
    When it is built for a target missing one of them
    Then the missing column reads as its typed default and the held one as itself
    And a default of another type than the column's does not compile

  @integration
  Scenario: Nested columns, AggregateFunction merges, lambdas and bound constants run on 26.8
    Given ClickHouse 26.8, the reader identity and tables with Nested, AggregateFunction, SimpleAggregateFunction and DateTime columns
    When the second census's shapes are built and sent
    Then each returns exactly its tenant's rows, also when the setting lists every tenant
    And a JSON type, a trim character set, a date unit and a time zone sent as bound values run as constants

  @unit
  Scenario: A read bounds a nullable id or a list of ids by the id index marker
    Given a read bounding a Nullable(String) id column by one id, and another by a list of ids
    When each is built
    Then the one id renders as an equality and the list as an IN over an Array(String) parameter, each with the marker the client reads
    And an empty list is refused by code, and a column that holds no string ids does not compile

  @unit
  Scenario: Equal ids share one parameter so every id bound marker names it
    Given a read bounded by an id and a CTE or scalar subquery bounded by the same id
    When it is built
    Then both markers name one parameter, so the client looks the id up once instead of refusing mixed bounds

  @unit
  Scenario: A derived join side carries its own tenant predicate and joins on its tenant column
    Given two derived reads under the read's scope, each selecting its tenant column
    When one is joined to the other
    Then each side renders its own read with the tenant predicate inside, joined on the tenant column
    And a derived side that does not select its tenant column, one built under another scope and one the builder did not make are refused by code

  @unit
  Scenario: A CTE reads the CTEs declared before it, and no other name
    Given a read with two CTEs, the second reading the first
    When it is built
    Then each CTE body carries the tenant predicate on its own table
    And a CTE name not declared before the text that reads it is refused by code, since it would read a stored table of that name

  @unit
  Scenario: A scalar subquery reads one value under the read's own scope
    Given a read comparing a column with a scalar subquery that selects one value
    When it is built
    Then the subquery renders with the tenant predicate on its own table, under the read's scope
    And a subquery over a table of another scope, a table the scope may not read, or selecting more than one value is refused by code

  @integration
  Scenario: Nullable and listed ids, derived joins, chained CTEs and scalar subqueries run on 26.8
    Given ClickHouse 26.8, the reader identity and an evaluation table whose other tenant reuses the same ids
    When the third census's shapes are built, their id markers expanded as the client expands them, and sent
    Then each returns exactly its tenant's rows, also when the setting lists every tenant
    And a day start in a bound time zone runs as a constant
