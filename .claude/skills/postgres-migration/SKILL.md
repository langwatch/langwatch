---
name: postgres-migration
description: "Change the Postgres schema without breaking the running release: the expand/contract recipes for adding a column, removing one, renaming one, making one NOT NULL and splitting a table, where schema.prisma and packages/prisma-client/prisma/migrations live, the unqualified-table-name rule, why a deployed migration is immutable, the retirement note the scanner requires before any DROP, and how an event-sourced projection table changes (a rebuild beside the old one, never an ALTER). Use whenever someone says 'add a field', 'drop that column', 'rename this table', 'make it required', 'write a migration', 'the migration failed on deploy', or a migration-safety test named their migration."
user-invocable: true
argument-hint: "<the schema change, or the migration name the scanner refused>"
---

# Change the Postgres schema without breaking the running release

The whole rule: **a migration is applied to the live database before the new image
rolls, so the old image keeps serving against the new schema — and if the roll is
reverted, the new schema outlives the image that wanted it.** Both directions have
to work. Deployment order can never matter. ADR-155 is the ruling; this is how.

Files: `packages/prisma-client/prisma/schema.prisma` and
`packages/prisma-client/prisma/migrations/<timestamp>_<slug>/migration.sql`.

```bash
# Edit schema.prisma, then generate the SQL WITHOUT applying it, so you can shape it:
pnpm --filter @langwatch/prisma-client exec prisma migrate dev --create-only --config ./prisma.config.ts
# Apply it (this is also what the deploy pipeline runs, as a task, before serve):
pnpm prisma:migrate
```

`--create-only` is not optional discipline — every recipe below edits the generated
SQL before it is applied, because Prisma generates the *breaking* form by default.

## The five rules that never bend

1. **Never edit a deployed migration.** Its checksum is recorded; a changed file makes
   `migrate deploy` refuse on every database that already ran it. Write a new one.
   (A migration that has not merged yet is still yours to fix.)
2. **Unqualified table names.** `"Monitor"`, never `"langwatch_db"."Monitor"` — the
   schema comes from the connection string, and a hard-coded one is wrong on every
   installation that named its database differently.
3. **Every new column is nullable or has a DEFAULT.** The image still serving does not
   name your column in its INSERTs, so a bare `NOT NULL` fails every one of them the
   moment the migration lands.
4. **Nothing is dropped in the same release that stopped using it.** A rollback to the
   previous image must still find its schema. Drop one full release later, and say so:
   `-- contract: retired in <release>` above the statement, naming the release whose
   code stopped reading and writing it.
5. **Nothing is renamed in place.** A rename is a drop and an add at once, and there is
   no moment where both images work. Use the four-step recipe.

## Recipe: add a column

One release. Nullable, or with a `DEFAULT`.

```sql
ALTER TABLE "Project" ADD COLUMN "slug" TEXT;
-- or, when every row needs a value:
ALTER TABLE "Project" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free';
```

A `DEFAULT` on a large table is instant in Postgres 11+ (the default is stored in the
catalogue, not written to every row), so there is no rewrite to fear.

## Recipe: remove a column

Two releases, because a rollback of release N must run against release N's schema.

- **Release N** — stop reading it and stop writing it. Leave the column in
  `schema.prisma` with a comment: `/// retired: unread since <release>, drops in <next>`.
  No migration.
- **Release N+1** — remove the field from `schema.prisma` and write:

```sql
-- contract: retired in 1.42.0
ALTER TABLE "Project" DROP COLUMN "legacyKey";
```

The note is what the scanner reads. It is not decoration: it records that a human
checked the wait, and names the release a reviewer can go and read.

## Recipe: rename a column

Four releases, or three when the write volume lets you dual-write and backfill in one.
There is a way back at every step.

1. **Add** the new column, nullable, beside the old one. Nothing reads it.
2. **Dual-write**: every writer sets both. Backfill the existing rows
   (`UPDATE "Project" SET "displayName" = "name" WHERE "displayName" IS NULL;` in the
   migration for a small table, a job for a large one).
3. **Switch the readers** to the new column. The old one is now written and unread.
4. **Retire** the old column under the removal rule above.

Reading both (`coalesce(new, old)`) collapses steps 2 and 3 into one release, at the
cost of one expression in the read. That is usually the right trade.

## Recipe: make a column NOT NULL

Never in the release that adds it, unless it has a `DEFAULT`.

1. **Release N** — the column exists, nullable. Make every writer set it, and backfill
   the nulls.
2. **Release N+1** — with the backfill proven complete:

```sql
UPDATE "Project" SET "slug" = "id" WHERE "slug" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "slug" SET NOT NULL;
```

The `UPDATE` stays in the migration even after the job ran: it is the guard for the
rows written between the job and the lock, and it is what the scanner looks for.

## Recipe: split a table

Same expand/contract, one table wider.

1. Create the new table. Nothing reads it.
2. Dual-write both, and backfill the old rows (a task under `apps/tasks/src/`, not a
   migration, once the table is big enough that the migration would hold a lock).
3. Switch the readers.
4. Retire the old columns one full release later, with the note.

A foreign key added in step 1 is `NOT VALID` first and `VALIDATE CONSTRAINT` in a later
migration when the table is large, because the immediate form takes a lock that blocks
writes for the length of a full table scan.

## Event-sourced projections are rebuilt, not altered

A projection table is derived state: the events are the record (ARCHITECTURE.md §9).
So a change to a projection's shape is **a rebuild, not an ALTER** — an ALTER leaves
every row folded by the old code and there is nothing in the table that says which.

1. Create the new projection **beside** the old one, under its own name.
2. Replay it: `ReplayService` (`packages/eventing/src/replay/`) sets a cutoff marker
   per projection, folds history up to the cutoff, and defers live events for an
   aggregate until its replay passes them — which is what keeps the rebuild and the
   live stream from interleaving out of order.
3. Wait for it to catch up. The old projection is still serving the whole time.
4. Switch the readers, then retire the old table under the removal rule.

Subscribers are at-least-once and per-aggregate ordered, so a rebuild that runs twice
must land the same rows; if your fold is not idempotent, that is the bug to fix before
the rebuild, not after.

## The scanner

```bash
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/prisma-client test src/__tests__/migration-safety.unit.test.ts
```

It reads every migration folder not in `src/__tests__/migration-safety.baseline.txt`
and fails by name, with the fix, on each rule above. The baseline is the migrations
already shipped when the scanner landed; it is **frozen**. Adding your migration's name
to it to get green is refused by the baseline test, and would in any case only hide a
migration that is about to take production down.

Spec: `specs/ops/migration-safety.feature`. ClickHouse: the `clickhouse-migration` skill.
