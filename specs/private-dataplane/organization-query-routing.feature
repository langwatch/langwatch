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
