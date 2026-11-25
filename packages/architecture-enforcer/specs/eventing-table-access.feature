Feature: The event tables are eventing's
  As a maintainer
  I want raw access to the event log and the process-manager tables reported outside packages/eventing
  So that a module changes an aggregate by sending its pipeline a command, never by writing its rows

  See dev/docs/ARCHITECTURE.md §7 (Alex, 2026-09-29): today's findings are a shrink-only list.

  @unit @architecture
  Scenario: SQL over an event table in module code is reported
    Given a module repository whose SQL reads event_log and updates ProcessManagerOutbox
    When the eventing-table-access policy reads the modules
    Then it reports both, naming the module and the table

  @unit @architecture
  Scenario: A Prisma delegate over a process-manager table is reported
    Given a module repository calling prisma.processManagerInstance.findMany
    When the eventing-table-access policy reads the modules
    Then it reports the delegate access

  @unit @architecture
  Scenario: Appending to the event store past the pipeline is reported
    Given a module store calling getEventStore().storeEvents
    When the eventing-table-access policy reads the modules
    Then it reports both calls

  @unit @architecture
  Scenario: A comment naming an event table is not an access
    Given a module file that mentions event_log only in a comment
    When the eventing-table-access policy reads the modules
    Then it reports nothing

  @unit @architecture
  Scenario: No new raw access to an event table lands
    Given the checked-in list of today's accesses with a count per file
    When the tree's accesses are read
    Then no file holds more accesses to a table than the list allows

  @unit @architecture
  Scenario: A removed access lowers the list in the same change
    Given the checked-in list of today's accesses with a count per file
    When the tree's accesses are read
    Then every listed count is still reached
