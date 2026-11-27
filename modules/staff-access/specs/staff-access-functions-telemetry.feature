Feature: Telemetry ops functions
  A staff session reads the platform's own ClickHouse through named functions that answer
  statement shapes, sources, error codes, counts and times, never a statement's text. They run
  under "ops:read" and read the shared ClickHouse through ops. ADR-202, amendment 2026-11-25.

  Background:
    Given cloud ops is on and the system flag "ops_agent_access_enabled" is on
    And Olivia holds the platform-operator grant and has a passkey

  @integration
  Scenario: ch.query_errors groups failed statements by shape, source and code
    Given a redeemed "ops:read" session naming "ch.query_errors"
    And ClickHouse failed a LangWatchQL statement for project "acme-support" with a memory limit
    When the agent calls "ch.query_errors" for the last day
    Then it answers a page with the statement's shape id, source "lwql", code 241 and its count
    And the group names project "acme-support" and holds no statement text

  @integration
  Scenario: ch.query_errors narrows to one source or one error code
    Given a redeemed "ops:read" session naming "ch.query_errors"
    When the agent calls "ch.query_errors" for source "dashboard" and code 159
    Then ops is asked for that source and that code only

  @integration
  Scenario: ch.query_errors refuses a range over seven days
    Given a redeemed "ops:read" session naming "ch.query_errors"
    When the agent calls "ch.query_errors" over eight days
    Then it is refused 422 with "staff_function_bad_input"

  @integration
  Scenario: Telemetry functions are not reachable from an organization session
    Given Olivia enrolled "laptop agent"
    When the agent asks for "org:metadata" on ACME naming "ch.query_errors"
    Then it is refused 422 with "staff_function_scope_mismatch"

  @unit
  Scenario: A source this release does not know reads as other
    Given the query log names a source no product read tags its statements with
    When ops reads the failed statements
    Then the group's source is "other"
    And a window that ends before it starts reads nothing

  @integration
  Scenario: ops reads failed statements from ClickHouse's query log
    Given a ClickHouse database where a statement tagged for LangWatchQL failed past its memory cap
    And a statement tagged for a dashboard failed with an unknown column
    When ops reads the failed statements of the last hour
    Then each answers its shape id, source, error code and name, count and newest time
    And the LangWatchQL group names its projects
    And a read narrowed to source "dashboard" answers only the dashboard group

  @integration
  Scenario: ch.health answers replicas, merges, disks, memory and a page of tables
    Given a redeemed "ops:read" session naming "ch.health"
    When the agent calls "ch.health" with a page of one table
    Then it answers the node count, replica, merge, disk and memory figures
    And the tables are a page with a cursor that reads on

  @integration
  Scenario: ops reads ClickHouse's health from its system tables
    Given a ClickHouse database holding one table with two parts
    When ops reads the server's health
    Then it answers at least one node and one disk with free space and resident memory
    And the table is listed with its active parts

  @unit
  Scenario: A named cluster reads the query log and health of every replica
    Given the ClickHouse cluster setting names a plain cluster
    When ops reads failed statements or the server's health
    Then each statement reads clusterAllReplicas over that cluster and skips unavailable shards

  @unit
  Scenario: Any other cluster-wide failure of the server reads is reported, not hidden
    Given a cluster-wide read refused for missing rights
    When ops reads failed statements or the server's health
    Then the refusal is thrown and the local node is never read

  @integration
  Scenario: A cluster ClickHouse does not know reads the local node's query log and health
    Given the ClickHouse cluster setting names a cluster the server does not know
    When ops reads failed statements and the server's health
    Then both answer from the local node's system tables

  @unimplemented
  Scenario: api.service_errors counts our own service errors by route
    Given the platform's own service traces were stored somewhere the platform can query
    When the agent calls "api.service_errors" for a route over the last day
    Then it answers counts by route, service and error code with sample trace ids

  @unimplemented
  Scenario: rum.boot_outcomes counts browser boot outcomes by day and release
    Given the platform's own browser telemetry was stored somewhere the platform can query
    When the agent calls "rum.boot_outcomes" over the last 14 days
    Then it answers counts by day, release and outcome with the p95 boot time