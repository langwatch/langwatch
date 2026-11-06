# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
#
# EVERY SCENARIO HERE IS @unimplemented ON PURPOSE, and only until it binds (see write-paths.feature
# in this folder for the convention).
#
# Copies of dataset rows outside the records table, found in a sweep of origin/main:
#   - Experiment.workbenchState / ExperimentVersion.state: inline datasets keep every cell
#     (modules/experiment/contract/src/experiment-workbench.ts:83-127), and saved-dataset previews
#     (`savedRecords`) are stripped only by the browser
#     (experiment-workbench-persistence.ts:110-123); the server parse keeps them
#     (experiment-workbench-version.ts:286, experiment-workbench.ts:118), so a REST
#     PUT /api/v1/experiments/:slug/workbench-state or a Langy write can store them.
#   - WorkflowVersion.dsl: optimization studio entry nodes keep inline rows
#     (modules/workflow/contract/src/studio-workflow.ts:307-322).
#   - BatchEvaluation.data: POST /api/dataset/evaluate stores the scored row
#     (modules/experiment/process/src/services/experiment-dataset-evaluation.service.ts:122-126).
#   - AuditLog.args: every tRPC mutation's input, bounded to 4 KiB, secrets redacted, row values
#     kept (packages/api/src/trpc/runtime.ts:2138-2156;
#     modules/audit-log/process/src/services/audit-log.service.ts:72-78).
#   - LWQL `dataset_records` reads the records table
#     (modules/analytics/process/src/features/lwql-catalogue/rules/lwql-postgres-view-catalog.rules.ts:418-429).
#   - The usage report's dataset_records counts records-table rows
#     (modules/ops/contract/src/usage-report.ts:342-346).
#   - Erasing an organization deletes records-table rows and dataset rows only
#     (modules/user/process/src/repositories/prisma/prisma.user-data-erase.repository.ts:268-269);
#     chunks, version chunks and single files stay in object storage.
# Noted, not changed by this epic: prompt few-shot demonstrations (prompt config), Langy
# conversation projections, ClickHouse experiment_run_items.DatasetEntry, and the 24 h Redis run plan.
#
# Inline workbench and studio datasets are user-authored setup, not saved datasets. Whether their
# rows move to object storage is a product decision held for a ruling; their scenarios below say
# what the move would mean if it is taken.

Feature: Copies of dataset rows outside the records table are removed or moved
  As a LangWatch operator
  I want dataset rows kept only in object storage, not copied into other Postgres tables
  So that removing the records table really leaves Postgres with metadata only

  Rule: An experiment never stores a saved dataset's rows

    # becomes @unit
    @unimplemented
    Scenario: A workbench state sent with a saved dataset's rows is stored without them
      Given an experiment whose workbench uses the saved dataset "support-tickets"
      When the workbench state is saved through the REST API with 20 of that dataset's rows attached
      Then the stored workbench state names "support-tickets" and holds none of its rows
      And reopening the experiment shows the rows of "support-tickets" read from the dataset

    # becomes @unit
    @unimplemented
    Scenario: Experiments saved with a saved dataset's rows are cleaned by a background step
      Given an experiment and one of its versions stored with a saved dataset's rows attached
      When the workbench cleanup step runs
      Then neither the experiment nor the version holds those rows
      And everything else in their workbench state is unchanged

  Rule: Dataset row values are not kept in the audit log

    # becomes @unit
    @unimplemented
    Scenario: Adding dataset rows is audited without the row values
      When a member adds 3 rows to a dataset from the platform
      Then the audit log records who added rows to which dataset, and how many
      And the audit entry holds none of the row values

    # becomes @unit
    @unimplemented
    Scenario: Editing a dataset row is audited without the row values
      When a member edits a row of a dataset from the platform
      Then the audit entry names the dataset and the row id
      And it holds neither the old nor the new values

    # becomes @unit
    @unimplemented
    Scenario: Saving an experiment or a workflow is audited without its inline rows
      When a member saves an experiment workbench or a workflow that holds an inline dataset
      Then the audit entry names the experiment or workflow
      And it holds none of the inline dataset's cells

  Rule: Erasing an organization's data erases its dataset content in object storage

    # becomes @integration
    @unimplemented
    Scenario: Erasing an organization removes its dataset chunks, version chunks and single files
      Given an organization with a dataset stored in object storage, a saved version of it and a single-file dataset
      When the organization's data is erased
      Then none of those datasets' objects remain in object storage

  Rule: Queries and reports stop counting on the records table

    # becomes @unit
    @unimplemented
    Scenario: The usage report counts dataset rows from the datasets themselves
      Given a project with a dataset of 5 rows stored in object storage
      When the usage report is collected
      Then it reports 5 dataset rows for that project

    # becomes @unit
    @unimplemented
    Scenario: LWQL no longer offers the records table
      When a member queries the LWQL table "dataset_records"
      Then the query is refused naming "datasets" and its row count as the replacement

  Rule: Batch evaluation rows are kept in object storage

    # becomes @integration
    @unimplemented
    Scenario: A dataset evaluation keeps the scored row in object storage
      When a row is scored through POST /api/dataset/evaluate
      Then the scored row is kept in object storage and Postgres keeps only a reference to it
      And listing the experiment's batch evaluations returns the same row data as before

    # becomes @unit
    @unimplemented
    Scenario: Batch evaluation rows stored in Postgres before are moved by a background step
      Given batch evaluations stored with their rows in Postgres
      When the batch evaluation move step runs
      Then each batch evaluation reads the same row data from object storage
      And Postgres holds none of those rows

  Rule: Inline datasets keep their rows in object storage (held for a product ruling)

    # becomes @integration
    @unimplemented
    Scenario: An experiment's inline dataset keeps its rows in object storage
      Given an experiment with an inline dataset of 3 rows
      When the workbench is saved
      Then the inline rows are kept in object storage and the workbench state keeps only a reference
      And reopening the experiment shows the same 3 rows

    # becomes @integration
    @unimplemented
    Scenario: A committed experiment version keeps the inline rows it had
      Given an experiment version committed with an inline dataset of 3 rows
      When a row is added to the inline dataset and the workbench is saved
      Then the committed version still shows its 3 rows

    # becomes @integration
    @unimplemented
    Scenario: A workflow's entry node keeps its inline rows in object storage
      Given an optimization studio workflow whose entry node holds 2 inline rows
      When the workflow is saved or a version is committed
      Then the inline rows are kept in object storage and the workflow version keeps only a reference
      And running the workflow uses the same 2 rows
