# WHY THIS EXISTS
#
# The event tables are eventing's (ARCHITECTURE.md §7): only packages/eventing
# names them. Two modules still reach them: data-retention rewrites event_log's
# retention, and analytics publishes the tables as operator views. The ruling
# (Q205, 2026-10-06) gives both to eventing as surfaces: a retention operation
# the retention owner calls, and plain declarations of the tables' LWQL entries
# that analytics composes, so eventing never imports analytics.

@event-sourcing
Feature: Eventing's own surfaces over its tables
  As the module that owns tenant retention, or the one that publishes LWQL views
  I want eventing to rewrite and describe its own tables
  So that no module names event_log or the process-manager tables

  Rule: A category's retention over the event log is eventing's operation

    @unit
    Scenario: A category's retention rewrites only that category's finite rows
      Given a classification naming each aggregate type's retention class
      When a category's retention is applied for a tenant
      Then one rewrite runs over the event log for that tenant
      And it touches only rows of that category's aggregate types that may expire
      And it carries the category's marker

    @unit
    Scenario: The fallback category keeps every other finite category's rows out
      Given a classification whose unlisted aggregate types fall back to one category
      When the fallback category's retention is applied
      Then the rewrite excludes every aggregate type of the other finite categories

    @unit
    Scenario: Rows that never expire are never rewritten
      When any category's retention is applied
      Then the rewrite excludes the never-expiring event types, prefixes and aggregate types

    @unit
    Scenario: A category the classification does not name is refused
      When retention is applied for a category the classification does not name
      Then the operation is refused by name and nothing is rewritten

    @unit
    Scenario: A retention that is not a whole number of days is refused
      When retention is applied with a negative, fractional or oversized number of days
      Then the operation is refused as invalid and nothing is rewritten

    @unit
    Scenario: A rewrite's category is read back off its marker
      Given a recorded rewrite of the event log
      When its command is read back
      Then a marked rewrite answers its category
      And an unmarked rewrite, or a rewrite of another table, answers none

  Rule: Eventing declares its tables' LWQL entries as plain data

    @unit
    Scenario: Every event-table view analytics serves today is declared
      When the declarations are listed
      Then they name the event log view and the four process-manager views by today's names
      And each names its source table, its store and its tenant column

    @unit
    Scenario: Every column of a process-manager table is declared
      When a process-manager table's declaration is read
      Then every column of the model is exposed or omitted with a reason

    @unit
    Scenario: The declarations carry no access gate
      When the declarations are read
      Then none names a permission, so the composing module keeps deciding who reads each view
