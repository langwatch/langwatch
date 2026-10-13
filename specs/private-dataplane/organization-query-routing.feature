Feature: Organisation query routing
  Billing can address its organisation's instance while preserving project row ownership.

  @unit
  Scenario: Organisation billing reads reach the configured private instance
    Given an organisation has a private ClickHouse instance
    When billing reads an explicitly unscoped aggregate for that organisation
    Then the private instance answers and the shared instance receives no query

  @unit
  Scenario: Organisation routing preserves the project tenant on metered rows
    Given a billable event belongs to a project in an organisation with a private instance
    When the meter appends it with an explicit organisation route
    Then the private instance receives the original project tenant on the row

  @unit
  Scenario: Organisation routing cannot bypass tenant scope validation
    Given a request explicitly routes to a private organisation
    When its rows name another project or its read lacks a tenant predicate without a declared reason
    Then the tenant guard refuses it before any statement reaches the instance

  @unit
  Scenario: A read across one organisation's projects runs as one query on that organisation's server
    Given two projects of an organisation with a private ClickHouse instance
    When a budget read declares both projects as its tenant set and binds them in one TenantId IN list
    Then the private instance answers that one statement and the shared instance receives none

  @unit
  Scenario: A declared tenant set must be exactly what the statement binds
    Given a read declaring a tenant set
    When its TenantId IN list binds a tenant outside the set, leaves a declared tenant out, or can be disjoined away by an OR
    Then the tenant guard refuses it before any statement runs

  @unit
  Scenario: A tenant set spanning organisations is refused
    Given two projects that belong to different organisations
    When a read declares both as its tenant set
    Then it is refused as spanning organisations and no instance receives the statement

  @unit
  Scenario: A batch across one organisation's tenants is written as one insert on that organisation's server
    Given two tenants of an organisation with a private ClickHouse instance
    When one insert declares both as its tenant set and carries rows of each
    Then the private instance receives that one insert and the shared instance receives none

  @unit
  Scenario: A batch's rows must be exactly its declared tenant set
    Given an insert declaring a tenant set
    When a row names a tenant outside the set, a declared tenant has no row, or the request's tenant is not in the set
    Then the tenant guard refuses it before any instance receives the insert

  @unit
  Scenario: A batch whose tenant set spans organisations is refused
    Given two tenants that belong to different organisations
    When one insert declares both as its tenant set
    Then it is refused as spanning organisations and no instance receives the insert
