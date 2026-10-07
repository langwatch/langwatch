Feature: Each SQL migration belongs to one owner
  SQL stays central, and each migration is attributed to the owner of the
  tables it touches; a migration touching two owners' tables is refused
  (Alex, 2026-10-06, D3). A Postgres table's owner is the module claiming its
  model; a ClickHouse table's owner is the module writing it, or its record.
  Migrations already merged are history: they sit on a shrink-only list beside
  the enforcer's tests, so only a new two-owner migration fails.

  @unit @architecture
  Scenario: A Postgres migration touching one owner's tables passes
    Given a Postgres migration alters two tables the same module claims
    When the migration-owners policy runs
    Then it reports nothing for that migration

  @unit @architecture
  Scenario: A Postgres migration touching two owners' tables is refused naming both
    Given a Postgres migration alters a table project claims and a table dataset claims
    When the migration-owners policy runs
    Then it reports the migration, naming project and dataset and a table of each

  @unit @architecture
  Scenario: A Postgres data step reading another owner's table is refused
    Given a Postgres migration updates a dataset table from a select over a project table
    When the migration-owners policy runs
    Then it reports the migration, naming project and dataset

  @unit @architecture
  Scenario: A ClickHouse migration touching two owners' tables is refused naming both
    Given a ClickHouse migration alters a table trace writes and a table analytics writes
    When the migration-owners policy runs
    Then it reports the migration, naming trace and analytics

  @unit @architecture
  Scenario: A table no module owns does not count as an owner
    Given a Postgres migration alters a claimed table and a table no module claims
    When the migration-owners policy runs
    Then it reports nothing for that migration

  @unit @architecture
  Scenario: A ClickHouse rollback half is not read
    Given a ClickHouse migration whose up half touches one owner and whose down half touches another
    When the migration-owners policy runs
    Then it reports nothing for that migration

  @unit @architecture
  Scenario: A foreign key reference is not a touch
    Given a Postgres migration creates a table whose foreign key references another owner's table
    When the migration-owners policy runs
    Then it reports nothing for that migration

  @unit @architecture
  Scenario: Today's two-owner migrations are listed and a new one fails
    Given the shrink-only list of two-owner migrations in tests/baselines/migration-owners.json
    When the tree's two-owner migrations are compared with the list
    Then none is missing from the list
    And every listed migration still touches two owners
