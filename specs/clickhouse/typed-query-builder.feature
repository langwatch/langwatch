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

  # ---------------------------------------------------------------------------
  # System tables on the system identity (ADR-202, "What needs a policy-exempt identity")
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An all-tenants read names the system tables only the system identity reads
    Given an all-tenants scope stating its reason
    When it reads system.parts, system.disks, system.backup_log, system.tables or system.mutations
    Then the statement goes out on the system identity as an all-tenants statement
    And it carries no tenant setting and no tenant predicate, and every compared value is bound

  @unit
  Scenario: A system table naming other tenants is refused on every reader scope
    Given a server-metadata, single-tenant or tenant-set scope
    When it names system.mutations, system.parts or system.tables
    Then the read does not type-check
    And it is refused at run time, even when the descriptor is relabelled as server metadata
    And an all-tenants scope naming a server-metadata table or a system table on neither list is refused the same way

  @unit
  Scenario: An id index's tenant listing is an all-tenants read beside its raise
    Given an id index's table name
    When its tenant listing is built
    Then it selects the index's distinct TenantId as a system statement, sent routed by target
    And a name that is not an id index's table is refused, and the api's client refuses the listing by name

  @integration
  Scenario: On 26.8 the reader cannot list what the system-table reads need
    Given ClickHouse 26.8 and a reader granted one tenant table and the three server-metadata tables, beside a table it is not granted
    When the reader reads system.parts, system.disks, system.backup_log and system.mutations
    Then each is refused as access denied
    And system.tables, which every user may read, lists the granted table and not the other

  @integration
  Scenario: The system-table reads run on 26.8 as main's raw queries do
    Given ClickHouse 26.8, two tenants' tables, a table the reader is not granted, and retention rewrites of each tenant
    When the footprint, disk, backup, held-table, mutation and id-index tenant reads are built and sent as the system
    Then each returns the rows main's raw query returns

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

  @unit
  Scenario: A built read on a table keyed on its own tenant column passes the client's guard
    Given a descriptor whose tenant column is project_id
    When a read of it is built and sent through the client
    Then the statement names project_id as the tenant column its predicates bind, and the client's guard checks that column as it checks TenantId
    And a predicate on it bound to another tenant, beside an OR, under a NOT or written as a literal is refused

  @unit
  Scenario: A raw statement cannot borrow a built statement's tenant column
    Given the text of a built read keyed on project_id
    When it is sent as a raw statement, with or without the built statement's tenant columns
    Then the guard refuses it for a missing TenantId predicate

  @unit
  Scenario: The latest-version election repeats the read's id bounds on any column of its table
    Given a latest-version read bounded by an id on a column outside the sort key
    When it is built
    Then the election repeats the id bound, alone of an AND's terms, naming the outer bound's parameter
    And a plain filter on a column outside the sort key stays out of the election

  @unit
  Scenario: A JSON path element may be a lambda's parameter, never spliced as text
    Given a JSON read whose path holds a lambda's parameter, a bound parameter, a key and an index
    When it is built
    Then the lambda's parameter renders as itself, the key binds as a String and the index as an Int64

  @integration
  Scenario: A repeated id bound and a JSON path from a lambda's parameter run on 26.8
    Given ClickHouse 26.8, the reader identity and tables whose other tenant reuses the same ids
    When an election repeating an id bound and a JSON path keyed by a lambda's parameter are built and sent
    Then each returns exactly its tenant's rows, also when the setting lists every tenant

  @unit
  Scenario: A latest-version read repeats the conditions on the columns it declares stable per key
    Given a latest-version read filtering a column that never changes between a key's versions
    When the read names that column in the election's repeat list
    Then the election repeats each term reading only that column, the keys or the time column, sharing its parameters
    And terms on undeclared columns stay out of the election, and a read declaring none elects as before
    And a repeat list naming the tenant column or another table's column is refused

  @unit
  Scenario: A where condition marked outside the election filters the elected rows only
    Given a latest-version read paged by a cursor on its key and time columns
    When the cursor condition is marked inElection false
    Then the outer WHERE carries the cursor and the election elects over every version of the key
    And an unmarked cursor is repeated inside the election, as before

  @unit
  Scenario: A key tuple is a member of zipped bound arrays
    Given a lookup of span keys sent as two parallel arrays
    When the key tuple is tested against arrayZip of the two bound arrays
    Then the read renders the tuple's membership in arrayZip of two bound String arrays
    And a membership set that reads a column is refused

  @integration
  Scenario: An outer-only cursor and zipped tuple membership run on 26.8 as main's reads do
    Given ClickHouse 26.8, the reader identity and a span whose latest version moved before the page cursor
    When the page is built with its cursor outside the election and sent
    Then the span is not on the page, as main pages it, while a repeated cursor returns its stale version
    And a zipped tuple membership returns exactly its tenant's keys and prunes the primary key as the raw form does

  @unit
  Scenario: Rows zipped from bound arrays are a source that reads no table
    Given parallel bound arrays of series ids, epoch milliseconds and point ids
    When a read selects from rows zipped from those arrays
    Then each row's columns are the arrays' elements, typed by their arrays, from arrayJoin of arrayZip of the bound arrays
    And a column that is not a bound array, arrays of unequal length and a server-metadata read of the rows are refused

  @unit
  Scenario: Bound rows never stand in for a tenant table
    Given a tenant scope and a read whose only sources are bound rows
    When it is built
    Then the builder refuses it, under a single, a set and an all-tenants scope
    And a read joining the rows to a tenant read carries that read's tenant predicate and the tenant setting

  @unit
  Scenario: A derived read of bound rows joins a tenant read without a tenant equality
    Given a derived tenant read selecting its tenant column and a derived read of bound rows
    When one joins the other
    Then the join's ON holds the caller's condition alone and the tenant side keeps its predicate in its own subquery
    And a derived tenant read that drops its tenant column is still refused as a join side

  @unit
  Scenario: A UNION ALL arm keeps its own order and LIMIT BY under its own scope
    Given a union whose second arm is ordered and limited to one row per series
    When it is built
    Then the arm renders its ORDER BY and LIMIT 1 BY inside its own parentheses
    And each arm carries the tenant predicate, the statement carries the tenant setting, and the client's tenant guard passes it

  @integration
  Scenario: The metric successor seek runs on 26.8 as main's raw query does
    Given ClickHouse 26.8, the reader identity and metric_data_points created by its goose migration, another tenant reusing the series ids
    When the successor seek is built from bound span rows, a derived points read and an ordered union arm, and sent
    Then it returns the rows main's raw query returns, also when the setting lists every tenant

  @unit
  Scenario: A latest-version read elects on the column its engine replaces by
    Given a table whose engine replaces by StartTime while its descriptor's version column is UpdatedAt
    When the read elects its latest version naming StartTime as the version
    Then the election takes the max of StartTime over the descriptor's keys, under the same tenant predicate
    And a read naming no version elects on the descriptor's version as before
    And a version naming the tenant column or another table's column is refused

  @integration
  Scenario: An election on a named version column runs on 26.8 as main's read does
    Given ClickHouse 26.8, the reader identity and a span with two versions sharing its latest StartTime
    When the read elects on StartTime and is sent
    Then both versions come back with the span's other keys, as main's raw read returns them, and an older StartTime does not

  @unit
  Scenario: An array literal of typed expressions shares one element type
    Given expressions of one value type, such as a column and an if of bound strings
    When a read selects an array literal of them
    Then it renders array(…) of the elements, and a lambda over it binds a compared value as the elements bind
    And elements binding as two types and an empty literal are refused, and mixed value types do not compile

  @unit
  Scenario: Conditions are Bool expressions outside a read's callback, binding their values
    Given equalities, prefix tests and their OR written outside a where, having or selection callback
    When they form a lambda body, an if's condition, a selected value or a where callback's term
    Then each value binds as a parameter the way its left side binds, a lambda parameter included
    And a value against a lambda parameter with no binding is refused rather than written as text
    And a condition over a column of a table the read does not read does not compile and is refused at build

  @unit
  Scenario: Trace's LangWatch signals read binds every value and passes the tenant guard
    Given each span's attribute keys read once in a derived read of its latest version
    When the signals are selected as arrayFilter over an array literal of one if per bucket
    Then the statement holds no string literal: every key, prefix and bucket name is bound
    And it carries the tenant predicate and setting, and the client's tenant guard passes it under a single and a set scope

  @integration
  Scenario: Trace's LangWatch signals read runs on 26.8 as main's raw query does
    Given ClickHouse 26.8, the reader identity, spans whose keys fill each bucket, a span whose latest version drops its signal, and another tenant holding every key
    When the signals read is built from an array literal and conditions, and sent
    Then it returns the rows main's raw query returns, also when the setting lists every tenant

  @unit
  Scenario: An approximate distinct count takes one or more expressions of any type
    Given a read counting distinct trace and span id pairs, as main's model usage stats do
    When it selects uniq of both columns, and of one string or numeric column
    Then each renders uniq of every expression given, counted as a UInt64
    And a count over a column of a table the read does not read does not compile and is refused at build
