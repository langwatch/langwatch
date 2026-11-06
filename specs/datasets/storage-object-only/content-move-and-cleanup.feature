# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds (see write-paths.feature
# in this folder for the convention).
#
# Why a second move step. "dataset:move-content-to-object-storage" shipped in 3.21.0
# (modules/dataset/process/src/dataset.module.ts:42-54; packages/upgrade/releases/3.21.0.json:740-746).
# The create regression shipped in the same release, so every dataset created or copied after the
# step ran is back in the records table. A step recorded done never runs again
# (packages/upgrade/src/background/background-steps.service.ts:81-83), so the leftovers need a step
# under a new id. The new step reuses the existing move (services/dataset-migration.service.ts),
# whose resume, abort, dry-run, failure and concurrent-write scenarios are already in
# modules/dataset/specs/dataset-content-migration-scan.feature and whose bounded-memory and
# re-run scenarios are in specs/datasets/large-dataset-storage.feature; they are not repeated here.
#
# Why the cleanup is its own operator step. The move never deletes the records-table rows it
# copied (prisma.dataset-migration.repository.ts:130-139; ADR-032 D7). Nothing is deleted
# automatically: a deleting step is an operator step an operator confirms in Ops
# (dev/docs/adr/173-upgrades-run-on-deploy.md section 8; packages/upgrade/specs/contract-order.feature).
# Ops cannot start an operator step yet (.claude/skills/postgres-migration/SKILL.md rule 7), so
# the cleanup waits on that framework change. Upgrades always pass dryRun false
# (background-steps.service.ts:266), so the preview an operator reads before confirming is the
# read-only storage audit below.
#
# Proposed steps:
#   dataset:move-remaining-content-to-object-storage  data, background, needsOldWritersGone
#   dataset:delete-moved-records                       data, operator, after both moves and the single-file conversion

Feature: Remaining dataset rows move to object storage and leave the records table
  As a LangWatch operator
  I want every dataset still in the Postgres records table moved, checked and then removed from it
  So that the records table empties without any dataset losing a row

  Background:
    Given an installation with object storage configured

  Rule: A new background step moves every dataset still in the records table

    # becomes @unit
    @unimplemented
    Scenario: The remaining-content move runs where the first move is already recorded done
      Given the first content move is recorded done
      And a dataset created afterwards still keeps its 4 rows in the records table
      When the worker runs pending background steps
      Then the remaining-content move runs
      And the dataset reads its 4 rows from object storage with the same ids, in the same order

    # Old images (3.21.0 to 3.23.0) still create records-table datasets until they stop serving.
    # becomes @unit
    @unimplemented
    Scenario: The remaining-content move waits until no older image is serving
      Given an image that still creates datasets in the records table is serving
      When the worker sweeps background steps
      Then the remaining-content move stays pending

    # findPostgresDatasetIds does not filter archivedAt (prisma.dataset-migration.repository.ts:37-46).
    # becomes @unit
    @unimplemented
    Scenario: An archived dataset is moved too
      Given an archived dataset whose 2 rows are in the records table
      When the remaining-content move runs
      Then the archived dataset reads its 2 rows from object storage
      And it stays archived

    # becomes @unit
    @unimplemented
    Scenario: An empty dataset is moved as an empty dataset
      Given a dataset in the records table with no rows
      When the remaining-content move runs
      Then the dataset is marked as stored in object storage with 0 rows and no chunks

    # The move reads rows by dataset and project (prisma.dataset-migration.repository.ts:78-92), so a
    # row filed under another project is never copied.
    # becomes @unit
    @unimplemented
    Scenario: Rows filed under a different project than their dataset are reported, not moved
      Given a dataset with 3 rows in the records table, one of them filed under another project
      When the remaining-content move runs
      Then the dataset reads its 2 rows from object storage
      And the step's report counts 1 row filed under another project for that dataset

    # becomes @integration
    @unimplemented
    Scenario: A dataset that fails to move stays readable from the records table
      Given object storage refuses the chunk writes of one dataset
      When the remaining-content move runs
      Then that dataset still reads every row from the records table
      And its records-table rows are untouched
      And the step is not recorded done

  Rule: The records table is emptied only by an operator, only of rows already checked against object storage

    # becomes @integration
    @unimplemented
    Scenario: The records-table cleanup waits for an operator
      When an upgrade ships the records-table cleanup
      Then the cleanup is recorded pending as an operator step
      And no records-table row is deleted until an operator confirms it in Ops

    # becomes @unit
    @unimplemented
    Scenario: The cleanup deletes a moved dataset's rows only when object storage holds every one of them
      Given a dataset stored in object storage whose 3 rows are also left in the records table
      And its chunks hold the same 3 ids with the same entries
      When the operator runs the records-table cleanup
      Then the 3 records-table rows of that dataset are deleted
      And the dataset still reads its 3 rows from object storage

    # becomes @unit
    @unimplemented
    Scenario: A moved dataset whose chunks disagree with its records-table rows keeps them
      Given a dataset stored in object storage whose records-table rows hold an id its chunks do not
      When the operator runs the records-table cleanup
      Then none of that dataset's records-table rows are deleted
      And the cleanup's report names the dataset and the id its chunks lack
      And the cleanup is not recorded done

    # becomes @unit
    @unimplemented
    Scenario: The cleanup never deletes rows of a dataset that has not been moved
      Given a dataset whose rows are still only in the records table
      When the operator runs the records-table cleanup
      Then every one of its rows is kept
      And the cleanup is not recorded done

    # Real installs can hold rows whose project differs from their dataset's, and rows whose dataset row
    # is gone. Those rows are not provably in object storage, so they stay for the table's archive
    # (records-table-retirement.feature).
    # becomes @unit
    @unimplemented
    Scenario: Rows that belong to no moved dataset are left for the table's archive
      Given records-table rows filed under a project other than their dataset's
      And records-table rows whose dataset no longer exists
      When the operator runs the records-table cleanup
      Then those rows are kept
      And the cleanup's report counts them as left for the archive

    # becomes @unit
    @unimplemented
    Scenario: The cleanup deletes in bounded batches and resumes where it stopped
      Given 25000 records-table rows of moved datasets
      And the cleanup stops after deleting 10000 of them
      When the cleanup runs again from its checkpoint
      Then it deletes the remaining 15000
      And no single delete removes more than one batch of rows

  Rule: An operator can see what is left before confirming anything

    # Read-only, like the plan and verify phases of `pnpm task object-storage-migrate`
    # (modules/stored-object/process/src/tasks/object-storage-migrate.task.ts:286-292).
    # becomes @integration
    @unimplemented
    Scenario: The dataset storage audit lists what is left per organization without changing anything
      Given an organization with 2 datasets in the records table holding 7 rows
      And 1 single-file dataset
      And 5 records-table rows left behind by datasets already in object storage
      When the operator runs the dataset storage audit
      Then it shows, for that organization, 2 datasets and 7 rows not yet moved, 1 single-file dataset and 5 rows awaiting cleanup
      And no dataset, chunk or records-table row is changed
