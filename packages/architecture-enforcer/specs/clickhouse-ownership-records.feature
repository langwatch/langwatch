Feature: ClickHouse ownership records and named exceptions
  The clickhouse-table-ownership policy gives every table one module owner.
  Two rulings narrow it (Alex, 2026-10-06, Q207): event_log is recorded as
  framework owned and the legacy tables as legacy owned, and trace's
  one-statement subqueries into other modules' tables are named exceptions.
  Each record and exception is declared in the policy with a written reason.

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
  Scenario: Every record and named exception carries a reason
    When the declared records and exceptions are read
    Then each one has a non-empty reason
