# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
# Decision record: dev/docs/adr/032-datasets-s3-jsonl.md (D1, D7, I-PG, v13).
#
# A scenario still tagged @unimplemented is planned, not built, and names the tag it becomes in a
# comment above it; the commit that makes it pass swaps the tag and adds the `@scenario`
# annotation in the same change.
#
# Out of this file on purpose: create and copy. They are fixed on their own branch, with scenarios
# in specs/datasets/large-dataset-storage.feature ("A new dataset is created directly in object
# storage", "A failed create leaves no dataset behind", "A copy of a dataset is created directly in
# object storage"). Since the module split (#7536, shipped in 3.21.0) DatasetUpsertService.create
# inserted a Postgres-layout row and wrote DatasetRecord rows
# (modules/dataset/process/src/services/dataset-upsert.service.ts:196-214), and the repository's
# create never names a layout (repositories/prisma/prisma.dataset.repository.ts:161-171), so the
# schema default "postgres" applied (packages/prisma-client/prisma/schema.prisma:2212).

Feature: Every write puts dataset rows in object storage
  As a LangWatch operator
  I want no write path to put dataset rows into the Postgres records table
  So that object storage is the only place dataset content lives and Postgres keeps metadata only

  Background:
    Given an installation with object storage configured

  Rule: A dataset in object storage never gains rows in the records table

    # createMany, update and replaceAll read the dataset's layout first, under the caller's lock
    # when it holds one (rules/dataset-records-table.rules.ts). ADR-032 I-PG.
    @unit
    Scenario: A records-table write for a dataset kept in object storage is refused
      Given a dataset whose rows are kept in object storage
      When any part of the dataset module asks the records table to store rows for it
      Then the write is refused, naming the dataset
      And no row is added to the records table

    # REST POST /api/dataset (modules/dataset/process/src/transport/dataset.rest.ts:190), tRPC
    # dataset.upsert (dataset.trpc.ts:17), MCP and both SDKs all reach the same create service.
    # The record shape {id, datasetId, projectId, entry, createdAt, updatedAt} is the public
    # contract (modules/dataset/contract/src/dataset.ts:239-248) and must not change.
    @integration
    Scenario: A dataset created with rows through the public API answers exactly as before
      Given an API key for a project
      When a dataset named "support-tickets" is created through the REST API with two rows that carry their own ids
      Then reading "support-tickets" through the REST API returns those two rows with the same ids and entries
      And each row has an id, a dataset id, a project id, an entry, a created time and an updated time
      And the records table holds no row for "support-tickets"

  Rule: Rows added to a dataset that has not been moved yet are never lost to the move

    # The upload append writes records-table rows under the dataset lock the move's flip takes
    # (services/dataset-upload.service.ts, prisma.dataset-migration.repository.ts); a flip that
    # lands first makes the table refuse them, and they go to the chunks instead.
    @integration
    Scenario: A file appended to a dataset that is being moved keeps every row
      Given a dataset whose 3 rows are still in the records table
      And the move of its content to object storage has read those rows but not yet committed
      When a file of 2 rows is appended to the dataset
      Then the move leaves the dataset where it is for its next pass
      And after the next pass the dataset reads 5 rows from object storage

    # Version rows already live in object storage, so the restore writes them as the dataset's
    # chunks and flips it (services/dataset-version.service.ts).
    @unit
    Scenario: Restoring a version of a dataset still in the records table moves it to object storage
      Given a dataset whose rows are still in the records table
      And a saved version 2 of that dataset with 4 rows
      When version 2 is restored
      Then the dataset reads the 4 rows of version 2 from object storage
      And the dataset is marked as stored in object storage
      And the records-table rows it had are left for the records-table cleanup to delete

  Rule: Nothing creates a dataset in the records table by default

    # The DB default is the rolling-deploy guard for images that omit the column (ADR-032 Constants;
    # 3.21.0 to 3.23.0 images do). It flips only once the oldest supported release creates every
    # dataset in object storage (ADR-155 rule 2; packages/upgrade/releases/lts-floor.json, which
    # does not exist yet). Changing a default holds no data, so the migration guard allows it
    # (.claude/skills/postgres-migration/SKILL.md rule 7).
    # becomes @integration
    @unimplemented
    Scenario: A dataset row inserted without naming its storage is marked as stored in object storage
      Given the oldest supported release creates every dataset in object storage
      When a dataset row is inserted without naming where its content lives
      Then the dataset is marked as stored in object storage

    # The demo seed creates its dataset with contentLayout "postgres" and upserts DatasetRecord rows
    # straight into Postgres (apps/tasks/src/storage-seed/seed-demo-platform.ts:268-290).
    # becomes @integration
    @unimplemented
    Scenario: The demo platform seed creates its sample dataset in object storage
      When the demo platform is seeded
      Then the sample dataset's rows are readable from object storage
      And the records table holds no row for the sample dataset
