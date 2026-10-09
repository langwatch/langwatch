# Archive-or-fail (Alex, 2026-10-09): a contract step never drops unarchived data. A contract's SQL
# names each table it retires with `-- archive: <table>` beside `-- contract: retired in <release>`.
# Before the schema that holds it is applied, the runner copies each named table into
# `_retired_<table>_<release>` and checks the copy has the source's rows, or fails the contract
# step and applies nothing. A contract without an archive note runs as before.

Feature: A contract step archives what it drops, or fails
  As an operator of a LangWatch installation
  I want every table a contract retires copied and checked before the drop
  So that no upgrade drops data nobody kept

  @unit
  Scenario: A contract step's SQL names the tables it archives
    Given a Prisma contract folder with two archive notes and a goose contract with none
    When the image's contract archives are read
    Then the Prisma contract archives both tables and the goose contract archives nothing

  @unit
  Scenario: An archived table is copied and checked before the drop
    Given a contract step of 3.23.0 that archives a table holding three rows
    When the runner archives before applying 3.23.0's schema
    Then "_retired_<table>_3_23_0" holds the same three rows

  @unit
  Scenario: A copy that does not match the source fails the contract step
    Given a contract step that archives a table whose rows change while it is copied
    When the runner archives before applying its schema
    Then the archive fails naming the step and the table

  @unit
  Scenario: Archiving again copies nothing when the archive already matches
    Given a table archived by an earlier run that stopped before the drop
    When the runner archives again
    Then it copies nothing and reports the table already archived

  @unit
  Scenario: A table already dropped after its archive is not archived again
    Given the source table is gone and its archive is present
    When the runner archives again
    Then it copies nothing and reports the table already archived

  @unit
  Scenario: A dry run reports what would be archived and copies nothing
    Given a contract step that archives a table holding three rows
    When the archive is planned without running
    Then it names the table, its archive and its three rows, and no archive table exists

  @unit
  Scenario: A ClickHouse contract that asks for an archive fails
    Given a goose contract with an archive note
    When the runner archives before applying its schema
    Then the archive fails naming the step, because ClickHouse archives are not supported yet

  @integration
  Scenario: A failed archive fails the contract step and leaves the schema unapplied
    Given 3.22.0 ships a contract step that archives a table whose archive name is too long to keep
    When the upgrade runs to 3.22.0
    Then it exits step_failed naming the contract step, the step is failed in the ledger and the schema is not applied

  @integration
  Scenario: An archived contract release applies its schema after the copy
    Given 3.22.0 ships a contract step that archives a table holding two rows
    When the upgrade runs to 3.22.0
    Then the archive holds two rows before the schema is applied, and a second run copies nothing
