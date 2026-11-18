# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds (see write-paths.feature
# in this folder for the convention).
#
# Once the remaining-content move, the single-file conversion and the records-table cleanup are
# done, three ways of storing rows collapse to one. What goes:
#   - routing: contentOf (modules/dataset/process/src/services/dataset-record.service.ts:95-98) and
#     its records-table fallbacks (:142, :298-325, :364, :400-409, :444-459, :475); search
#     (dataset-record-search.service.ts:35-38, :88-159); counts (dataset-record-count.service.ts:40-48,
#     modules/dataset/contract/src/dataset-record-count.ts:5-28,
#     repositories/prisma/prisma.dataset-content.repository.ts:368-383); copy
#     (dataset-copy.service.ts); column edit re-key (dataset-upsert.service.ts:119-170); upload
#     append (dataset-upload.service.ts:162-178); version snapshot and restore
#     (dataset-version.service.ts:407-433, :477-481);
#   - repositories: prisma/memory dataset-record and dataset-migration;
#     the single-file service, rules and repositories (object storage and filesystem);
#   - config: DATASET_STORAGE_LOCAL / LOCAL_STORAGE_PATH for single files
#     (modules/dataset/contract/src/dataset.config.ts:13-16).
# No release is a required stop (.claude/rules/database.md:13; .claude/skills/migration/SKILL.md:18):
# an install on any older release pulls the latest image and rolls through every step. So the move
# steps (remaining-content move, single-file conversion) are never emptied: each keeps its own
# narrow reader of the old layout, private to the step, and that reader is the only old-layout code
# left. What is removed is the serving path above.
#
# A background step's finishBy is shown in Ops but not enforced by the runner
# (packages/upgrade/src/step/migration-step.ts:37; only the reader keeps it,
# packages/upgrade/src/reader/step-view.ts:98). A blocking step is frozen SQL and cannot read a
# file or write a chunk (.claude/skills/migration-data-step). And the new image cannot wait for the
# move and the conversion before it serves: both declare needsOldWritersGone
# (modules/dataset/process/src/dataset.module.ts), so they start only once the previous image is
# gone, and waiting would stall the upgrade. So the new image serves at once, and a dataset still on
# an old layout answers a coded, transient upgrade-in-progress refusal until its step moves it.
# That per-dataset refusal is the prerequisite of the removal (ADR-032 v20). On an install with
# nothing left on an old layout no dataset is refused.

Feature: Dataset code keeps one way of storing rows
  As a LangWatch developer
  I want the records-table and single-file code paths removed once no dataset uses them
  So that every dataset read and write has one path, through object-storage chunks

  Rule: Every dataset operation goes through object-storage chunks

    # becomes @unit
    @unimplemented
    Scenario: Reading, searching and counting a dataset never consult the records table
      Given a dataset stored in object storage with 3 rows
      When its rows are listed, searched for a value one row holds and counted
      Then every answer comes from its chunks
      And the records table is never read

    # becomes @unit
    @unimplemented
    Scenario: Copying, editing columns, appending a file and restoring a version have one path each
      Given a dataset stored in object storage
      When it is copied, a column is renamed, a file is appended and a version is restored
      Then each operation reads and writes only object-storage chunks

    # becomes @unit
    @unimplemented
    Scenario: The move steps keep their own reader of the old layout after the serving path is removed
      Given the serving path no longer reads the records table or single files
      When the remaining-content move or the single-file conversion runs
      Then it reads the old layout through a reader private to that step
      And no serving code imports that reader

  Rule: An installation that skipped releases is moved during the upgrade, never sent back to an older release

    # becomes @integration
    @unimplemented
    Scenario: A direct upgrade serves at once and opens each dataset left on an old layout once it is moved
      Given an installation with one dataset still in the records table and one single-file dataset
      When it upgrades straight to the release that removes the old serving path
      Then the new release serves, and until the move reaches them both datasets answer upgrade in progress
      And once the previous release is gone the steps move the dataset and convert the single-file dataset
      And both datasets then open with every row
      And the upgrade never asks for an intermediate release and never waits on itself

    # becomes @integration
    @unimplemented
    Scenario: The new release serves at once when nothing is left on an old layout
      Given an installation whose datasets are all in object storage
      When it upgrades to the release that removes the old serving path
      Then the move and the conversion steps are recorded done with nothing moved
      And the new release serves without waiting
