# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds (see write-paths.feature
# in this folder for the convention).
#
# Nothing measures the move today: no metric or gauge names dataset storage, and the only signal is
# the step report (modules/dataset/process/src/services/dataset-migration.service.ts:124-131) on
# Ops > Upgrades. Install-wide gauges follow the observable-gauge pattern of
# modules/ops/process/src/services/storage-stats-gauges.service.ts:36-48. A per-organization label
# would make one series per organization on cloud, so the per-organization breakdown lives in the
# dataset storage audit and the step reports, not in metric labels. Cloud regions send the same
# usage report as self-hosted installs (ADR-173 section 5, Q-U6), so one fleet page shows every
# install's progress.

Feature: Operators can watch dataset rows leave Postgres
  As a LangWatch operator
  I want to see how many datasets and rows are still outside object-storage chunks
  So that I know when the move is finished and can tell a stuck one from a slow one

  Rule: The install reports what is left until it reaches zero

    # becomes @unit
    @unimplemented
    Scenario: The install reports datasets and rows not yet in object-storage chunks
      Given 2 datasets with 7 rows in the records table, 1 single-file dataset and 5 rows awaiting cleanup
      When the install's metrics are collected
      Then it reports 2 datasets in the records table, 1 single-file dataset and 12 records-table rows

    # becomes @unit
    @unimplemented
    Scenario: The report reads zero once every dataset is moved and the table is cleaned
      Given every dataset is stored in object-storage chunks and the records table is empty
      When the install's metrics are collected
      Then it reports 0 datasets in the records table, 0 single-file datasets and 0 records-table rows

    # becomes @unit
    @unimplemented
    Scenario: The usage report tells the fleet how many records-table rows an install has left
      Given an install with 12 records-table rows
      When the usage report is collected
      Then it reports 12 dataset rows still in Postgres for that install

  Rule: Logs about the move name datasets, never their rows

    # becomes @unit
    @unimplemented
    Scenario: Moving, converting and cleaning a dataset log its ids and counts only
      When a dataset with 3 rows is moved, converted or cleaned
      Then the log line names the project, the dataset, the row count and the outcome
      And it holds none of the row values
