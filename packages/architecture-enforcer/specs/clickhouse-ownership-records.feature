Feature: ClickHouse ownership records and named exceptions
  The clickhouse-table-ownership policy gives every table one module owner.
  Two rulings narrow it (Alex, 2026-10-06, Q207): event_log is recorded as
  framework owned and the legacy tables as legacy owned, and trace's
  one-statement subqueries into other modules' tables are named exceptions.
  A third (EF-5, 2026-10-07): an owner may share a table for reading with
  named modules, as trace shares trace_analytics with analytics; writes stay
  the owner's. Each record, exception and shared table carries a reason.

  Background:
    Given the policy reads the table list from the goose migrations

  @unit @architecture
  Scenario: A table recorded as framework owned is not an ownerless table
    Given a migration creates event_log and no module writes it
    And the policy records event_log as framework owned by packages/eventing
    When the policy runs
    Then no finding names event_log as having no module owner

  @unit @architecture
  Scenario: A table recorded as legacy owned is not an ownerless table
    Given a migration creates stored_objects and no module writes it
    And the policy records stored_objects as legacy owned with a reason
    When the policy runs
    Then no finding names stored_objects as having no module owner

  @unit @architecture
  Scenario: A module writing a recorded table is reported
    Given the policy records event_log as framework owned
    When a module's repository inserts into event_log
    Then the policy reports that module writing a table recorded as framework owned

  @unit @architecture
  Scenario: A record naming a table no migration creates is reported
    Given the policy records a table that no migration creates
    When the policy runs
    Then the policy reports the record as stale and asks for it to be deleted

  @unit @architecture
  Scenario: A declared one-statement subquery passes
    Given trace reads instant_eval_judgments inside one statement in a named file
    And the policy declares that reader, table and file as an exception with a reason
    When the policy runs
    Then no finding names trace reading instant_eval_judgments

  @unit @architecture
  Scenario: An undeclared foreign read still fails
    Given the policy declares trace reading instant_eval_judgments in one file
    When another trace file reads instant_eval_judgments
    Then the policy reports trace reading instant_eval_judgments in that other file

  @unit @architecture
  Scenario: A named exception matching no read is reported
    Given the policy declares an exception for a read the tree no longer makes
    When the policy runs
    Then the policy reports the exception as stale and asks for it to be deleted

  @unit @architecture
  Scenario: A module reading a table its owner shares with it passes
    Given trace writes trace_analytics and shares it for reading with analytics
    When analytics reads trace_analytics
    Then no finding names analytics reading trace_analytics

  @unit @architecture
  Scenario: A module the owner did not name still may not read a shared table
    Given trace shares trace_analytics for reading with analytics only
    When experiment reads trace_analytics
    Then the policy reports experiment reading trace_analytics, owned by trace

  @unit @architecture
  Scenario: A named reader writing a shared table is a second writer
    Given trace shares trace_analytics for reading with analytics
    When analytics inserts into trace_analytics
    Then the policy reports trace_analytics as written by two modules

  @unit @architecture
  Scenario: A shared table declared by a module that does not own it is reported
    Given the policy declares trace_analytics shared by analytics
    And trace is the module that writes trace_analytics
    When the policy runs
    Then the policy reports the declaration as naming the wrong owner

  @unit @architecture
  Scenario: A shared reader that no longer reads the table is reported
    Given trace shares trace_analytics for reading with analytics
    And analytics no longer reads trace_analytics
    When the policy runs
    Then the policy asks for analytics to be deleted from the declaration

  @unit @architecture
  Scenario: Every record and named exception carries a reason
    When the declared records, exceptions and shared tables are read
    Then each one has a non-empty reason
