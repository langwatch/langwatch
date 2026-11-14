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
    And the election repeats the read's key filters and nothing else

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
