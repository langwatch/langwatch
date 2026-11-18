# Epic: dataset content lives only in object storage; Postgres keeps dataset metadata.
# Decision record: dev/docs/adr/032-datasets-s3-jsonl.md (D1, D7, I-PG, v13).
#
# A scenario still tagged @unimplemented is planned, not built, and names the tag it becomes in a
# comment above it; the commit that makes it pass swaps the tag and adds the `@scenario`
# annotation in the same change. A file's first bound scenario also removes the file from
# LEGACY_INERT in both packages/architecture-enforcer/src/tools/check-feature-parity.ts and
# tools/featureparity/lists.go, which must stay equal.
#
# Where create and copy store rows is out of this file: specs/datasets/large-dataset-storage.feature
# ("A new dataset is created directly in object storage", "A failed create leaves no dataset
# behind", "A copy of a dataset is created directly in object storage"). From the module split
# (#7536, shipped in 3.21.0) until #9351, a create wrote records-table rows. The one create
# scenario below pins only the public answer a create gives, which this epic must not change.

Feature: Every write puts dataset rows in object storage
  As a LangWatch operator
  I want no write path to put dataset rows into the Postgres records table
  So that object storage is the only place dataset content lives and Postgres keeps metadata only

  Background:
    Given an installation with object storage configured

  Rule: A dataset in object storage never gains rows in the records table

    # createMany, update, deleteMany and replaceAll read the dataset's layout first, under the caller's lock
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

    # The restore replaces the table rows under the lock (services/dataset-restore-content.service.ts),
    # so the move's change check sees it. Writing chunks for a dataset the move has not flipped
    # would race the move's own chunk writes, which run before it takes the lock.
    @unit
    Scenario: Restoring a version of a dataset still in the records table keeps it there for the move
      Given a dataset whose rows are still in the records table
      And a saved version 2 of that dataset with 4 rows
      When version 2 is restored
      Then the dataset reads the 4 rows of version 2 from the records table
      And when the move flips the dataset while a restore waits, the restore writes the chunks instead

    # The record service decides where rows live before it takes the lock; the table refuses a
    # write the move beat to the lock, and the write goes to the chunks
    # (services/dataset-locked-records.service.ts).
    @unit
    Scenario: A record write that waited while the dataset moved goes to object storage
      Given a dataset whose 3 rows are still in the records table
      And the move flips it while a record write waits for the dataset's lock
      When a row is deleted, added or edited
      Then the change is in the dataset's chunks
      And no deleted row comes back

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

    # The demo seed creates its dataset through the dataset module
    # (apps/tasks/src/storage-seed/seed-demo-dataset.ts), so its rows are born in object storage.
    @integration
    Scenario: The demo platform seed creates its sample dataset in object storage
      When the demo platform is seeded
      Then the sample dataset's rows are readable from object storage
      And the records table holds no row for the sample dataset
