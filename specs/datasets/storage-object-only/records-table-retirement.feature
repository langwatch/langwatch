# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds (see write-paths.feature
# in this folder for the convention).
#
# How a table is retired here today:
#   - stop reading and writing it in release A, mark it `/// @deprecated` in schema.prisma and
#     register it in packages/upgrade/releases/deprecations/deprecations.json (precedent:
#     DataPrivacyProjectScope, schema.prisma:3869-3871);
#   - a new DROP TABLE in a Prisma migration is refused (.claude/skills/postgres-migration/SKILL.md
#     rule 7); the drop is an operator step of the owning module, confirmed in Ops
#     (dev/docs/adr/173-upgrades-run-on-deploy.md section 8);
#   - a drop happens only once release A is at or below the LTS floor in
#     packages/upgrade/releases/lts-floor.json (dev/docs/adr/155-migrations-are-never-breaking.md
#     rule 2), a file that does not exist yet;
#   - what a drop retires is first copied to `_retired_<table>_<release>` and checked, or the drop
#     fails (packages/upgrade/specs/contract-archive.feature).
# Because the cleanup (content-move-and-cleanup.feature) deletes every row already proven in object
# storage, the archive holds only rows nothing could prove, so dataset content does not linger in
# Postgres for another LTS.
#
# Proposed step: "dataset:retire-records-table", kind data, mode operator, after
# "dataset:delete-moved-records". Same retirement for Dataset.useS3 and Dataset.s3RecordCount
# (schema.prisma:2206-2207) once single-file datasets are converted.

Feature: The Postgres records table for dataset rows is retired
  As a LangWatch operator
  I want the dataset records table dropped once nothing reads it and nothing in it is unaccounted for
  So that Postgres holds dataset metadata only and no row is dropped that nobody kept

  Rule: The table is declared retired before it is dropped

    # becomes @unit
    @unimplemented
    Scenario: The release that stops reading the records table registers it as deprecated
      When the release deprecation register is read
      Then it names the Postgres table DatasetRecord with the release that stopped reading and writing it
      And it names object-storage chunks as its successor

    # becomes @unit
    @unimplemented
    Scenario: The legacy single-file columns are registered as deprecated with the table
      When the release deprecation register is read
      Then it names the dataset columns useS3 and s3RecordCount as deprecated in the same release

  Rule: The drop is an operator step that refuses while anything could still need the table

    # becomes @integration
    @unimplemented
    Scenario: The records-table drop is recorded pending and an upgrade never runs it
      When an upgrade ships the records-table drop
      Then the drop is recorded pending as an operator step
      And the records table still exists

    # becomes @unit
    @unimplemented
    Scenario: The drop refuses while any dataset still keeps its rows in the records table
      Given one dataset still keeps its rows in the records table
      When the operator runs the records-table drop
      Then it refuses, naming 1 dataset not yet moved
      And the records table still exists

    # becomes @unit
    @unimplemented
    Scenario: The drop refuses while any single-file dataset is left
      Given one dataset is still stored as a single file
      When the operator runs the records-table drop
      Then it refuses, naming 1 single-file dataset not yet converted

    # becomes @unit
    @unimplemented
    Scenario: The drop refuses below the supported floor
      Given the oldest supported release still reads the records table
      When the operator runs the records-table drop
      Then it refuses, naming the first release the drop may run in

  Rule: Whatever is left in the table is archived and checked before the drop

    # becomes @integration
    @unimplemented
    Scenario: The rows left after the cleanup are archived, then the table is dropped
      Given every dataset is stored in object storage
      And 3 records-table rows are left, none of them provably in object storage
      When the operator runs the records-table drop
      Then a retired copy of the records table holds the same 3 rows
      And the records table no longer exists
      And the drop is recorded done

    # becomes @integration
    @unimplemented
    Scenario: A failed archive leaves the records table in place
      Given the copy of the records table does not match its source
      When the operator runs the records-table drop
      Then the drop fails naming the records table
      And the records table and every row in it still exist

    # becomes @integration
    @unimplemented
    Scenario: Every dataset reads the same after the records table is dropped
      Given datasets that were moved, converted and created in object storage
      When the records table has been dropped
      Then each dataset reads the same rows, ids and counts through the REST API as before the drop
