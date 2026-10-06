@adr-134
Feature: The clickhouse-table-ownership lint rule
  One module owns a ClickHouse table and every other module reads it through
  that module's api. ClickHouse has no schema file and no generated client, so
  the table list is replayed from the goose migrations and access is read out
  of the SQL a module's repositories write. The findings read exactly like the
  Prisma ones: only the table name says which store a finding is about.

  Rule: `clickhouse-table-ownership` gives every ClickHouse table one module

  Background:
    Given a workspace whose migrations create the ClickHouse tables

  @unit
  Scenario: A module reading a table another module writes is reported
    Given the trace module inserts into a table the analytics module selects from
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports that analytics reads the table, owned by trace
    And the message says to read it through the owning module's api

  @unit
  Scenario: The module that writes a table may also read it
    Given the trace module both inserts into and selects from one table
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports nothing for that table

  @unit
  Scenario: A table two modules write is reported as two owners
    Given the trace and analytics modules both insert into one table
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports the table as written by both modules
    And the message names the file the first writer claims it from

  @unit
  Scenario: A table no module writes is its own finding
    Given a migration creates a table no module inserts into
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports that the table has no module owner
    And the finding names the migration that created it

  @unit
  Scenario: A table name reached through a file constant is still access
    Given a repository selects from a table named by a file-level constant
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports the access as if the name were written inline

  @unit
  Scenario: A materialised view belongs to the table it feeds
    Given a migration creates a table and a materialised view named for it
    When the clickhouse-table-ownership rule runs over the workspace
    Then the view and the table count as one table with one owner

  @unit
  Scenario: A table a later migration drops is not a table
    Given a migration creates a table and a later migration drops it
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports nothing about the dropped table

  @unit
  Scenario: A rollback half of a migration does not create a table
    Given a migration whose goose Down half creates a scratch table
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports nothing about the scratch table

  @unit
  Scenario: The migrations and the ClickHouse client are not module access
    Given only the ClickHouse client package names a table in its own SQL
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports the table as having no module owner
    And it reports no foreign reader for the client package

  @unit
  Scenario: A test naming a table is not access
    Given only a module's test files select from a table another module writes
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports no foreign reader for that module

  @unit
  Scenario: A table name imported from a sibling file is still access
    Given a repository inserts into a table named by a constant it imports from a relative file
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports the access as if the name were written inline

  @unit
  Scenario: A table name imported through a re-export is still access
    Given a repository inserts into a table named by a constant a barrel re-exports
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports the access as if the name were written inline

  @unit
  Scenario: A table name imported from another module's package is that module's table
    Given the analytics module selects from a table named by a constant imported from the trace module's package
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports that analytics reads the table, owned by trace

  @unit
  Scenario: Constants that import each other do not loop
    Given two files whose constants re-export each other
    When the clickhouse-table-ownership rule runs over the workspace
    Then the rule finishes and resolves the constant that is defined

  @unit
  Scenario: A table only a materialised view fills belongs to the module writing the view's source
    Given a materialised view copies a table the trace module writes into a second table
    And no module inserts into the second table
    When the clickhouse-table-ownership rule runs over the workspace
    Then the second table is owned by trace
    And it reports no table without an owner

  @unit
  Scenario: A foreign module reading a view-fed table is still a foreign read
    Given a table filled only by a materialised view over a table trace writes
    And the analytics module selects from the view-fed table
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports that analytics reads the table, owned by trace

  @unit
  Scenario: A view-fed table a module also inserts into keeps that writer as owner
    Given a table filled by a materialised view and also inserted into by the analytics module
    When the clickhouse-table-ownership rule runs over the workspace
    Then the analytics module owns the table

  @unit
  Scenario: A view a later migration drops feeds nothing
    Given a migration drops the materialised view that filled a table
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports the table as having no module owner

  @unit
  Scenario: A view whose source has no owner leaves its target without one
    Given a materialised view over a table no module writes
    When the clickhouse-table-ownership rule runs over the workspace
    Then it reports the view's target as having no module owner
