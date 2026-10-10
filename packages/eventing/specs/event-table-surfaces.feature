# WHY THIS EXISTS
#
# The event tables are eventing's (ARCHITECTURE.md §7): only packages/eventing
# names them. Two modules still reach them: data-retention rewrites event_log's
# retention, and analytics publishes the tables as operator views. The ruling
# (Q205, 2026-10-06) gives both to eventing as surfaces: a retention operation
# the retention owner calls, and plain declarations of the tables' LWQL entries
# that analytics composes, so eventing never imports analytics. Ops' process
# explorer, dead-letter acts, retention purge and event explorer ran raw SQL over
# the same tables; ET-1 (2026-10-08) gives them to eventing as an operator surface
# ops calls, and ET-2 has eventing publish its table list for modules that meter it.

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

    # Only customer telemetry expires (Alex, 2026-10-09): an unlisted aggregate type is kept forever.
    @unit
    Scenario: An aggregate type mapped to no category is never rewritten
      Given a classification whose unlisted aggregate types are mapped to no category
      When a category's retention is applied
      Then the rewrite touches only the aggregate types that category lists

    @unit
    Scenario: Every never-expiring row on a target is re-stamped to be kept forever
      When the never-expiring rows are kept forever on one ClickHouse target
      Then one rewrite stamps every tenant's never-expiring and unlisted rows there to 0 days
      And it carries the indefinite marker, read back as the indefinite class

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

  Rule: Operator work over the process-manager tables and the event log is eventing's surface

    @unit
    Scenario: The dead-letter list answers each retired message with the ref to act on it
      Given dead outbox messages across process managers
      When the operator surface lists dead messages
      Then each row carries its process name, project, process key and trace id
      And the total counts every dead message the filter matches

    @unit
    Scenario: An event search bounded by neither a tenant nor a query is refused
      When the event explorer is asked to search with a blank query and no tenant
      Then it refuses as invalid input and reads nothing

    @unit
    Scenario: An event search reads only rows inside its time bound
      When the event explorer searches with a lower time bound
      Then the read filters on the event log's partition time, keeping legacy rows

  Rule: Eventing publishes its table list with categories

    @unit
    Scenario: The event-table list names every table eventing owns, by store and category
      When the event-table list is read
      Then it names the event log as an event-log table in ClickHouse
      And the four process-manager tables as process-manager tables in Postgres
