# A goose step id is the file's numeric prefix alone (`clickhouse:<00000>`), so two goose files
# sharing a prefix are one step id twice. The ledger registers every shipped step in one
# INSERT ... ON CONFLICT, which Postgres refuses outright when an id repeats, and every pod failed
# preflight on that raw error naming no step and no file.

Feature: A step id the image ships twice is refused by name before it reaches the ledger
  As an operator of a LangWatch installation
  I want an image that ships one step id twice refused with the id and the files behind it
  So that I know which migration to renumber instead of reading a bare Postgres error

  @unit @regression
  Scenario: Two goose files sharing a numeric prefix are found as one duplicated step id
    Given a goose tree holding 00125_a.sql and 00125_b.sql
    When the tree's goose versions are checked
    Then clickhouse:00125 is reported with both files

  @unit @regression
  Scenario: A shipped step list naming one id twice reports the id and both sources
    Given the image's tree ships clickhouse:00003 from 00003_a.sql and 00003_b.sql
    When the shipped steps are checked for duplicates
    Then clickhouse:00003 is reported with 00003_a.sql and 00003_b.sql

  @integration @regression
  Scenario: An image shipping one step id twice fails preflight with duplicate_step naming it
    Given an image whose tree ships two goose files with the prefix 00003
    When the upgrade runs
    Then it exits 1 with duplicate_step naming clickhouse:00003 and both files
    And no step of the image is registered on the ledger
    And the run is recorded as failed

  @unit @regression
  Scenario: A release whose tree holds two goose files sharing a prefix is refused at the release check
    Given a tree cut as 3.22.0 holding 00125_a.sql and 00125_b.sql
    When the release identity is checked
    Then it is refused with duplicate_step naming clickhouse:00125 and both files
