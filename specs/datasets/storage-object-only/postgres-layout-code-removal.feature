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
#   - repositories: prisma/memory dataset-record, dataset-record-content, dataset-migration;
#     the single-file service, rules and repositories (object storage and filesystem);
#   - config: DATASET_STORAGE_LOCAL / LOCAL_STORAGE_PATH for single files
#     (modules/dataset/contract/src/dataset.config.ts:13-16).
# The old move steps stay declared (their ids are in shipped release manifests) but their run
# becomes a no-op that reports "nothing to move".
#
# A background step's finishBy is shown in Ops but not enforced by the runner
# (packages/upgrade/src/step/migration-step.ts:37; only the reader keeps it,
# packages/upgrade/src/reader/step-view.ts:98). Until it is enforced, the release that removes this
# code refuses at boot to serve an installation that still has datasets on an old layout.

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
    Scenario: The old content moves report nothing to move once the code is removed
      When the first content move or the remaining-content move runs on an installation with no dataset left to move
      Then it is recorded done with nothing moved

  Rule: An installation that skipped the move is told, not served wrong data

    # becomes @integration
    @unimplemented
    Scenario: A release without the old storage code refuses to start while datasets are left on an old layout
      Given an installation with one dataset still in the records table and one single-file dataset
      When the release that removes the old storage code starts
      Then it refuses to serve, naming 1 dataset not yet moved and 1 single-file dataset not yet converted
      And it names the upgrade steps to finish on the previous release
