---
name: postgres-migration
description: "Change the Postgres schema without breaking any release still in the supported window: the expand/contract recipes for adding a column or table, removing one, renaming one, changing its type, making it NOT NULL, adding an index or a unique constraint and splitting a table; the LTS floor (3.20.1) and the `-- contract: retired in <release>` note every drop needs; the lock-heavy shapes the guard refuses and the ops pre-build note for an index; re-runnable statements; one owner per migration; timestamp keys and the migration-order check; no new foreign key and no new @relation; where schema.prisma and packages/prisma-client/prisma/migrations live; inline DML as the simplest blocking data step; and how a projection table changes (a rebuild beside the old one). Use whenever someone says 'add a field', 'add a column', 'add a table', 'drop that column', 'drop the table', 'rename this table', 'rename the column', 'change the column type', 'make it required', 'NOT NULL', 'add an index', 'unique constraint', 'add a relation', 'foreign key', '@relation', 'onDelete Cascade', 'write a Prisma migration', 'the migration failed on deploy', 'prisma migrate resolve', or the migration-safety test named their migration."
user-invocable: true
argument-hint: "<the schema change, or the migration name the scanner refused>"
---

# Change the Postgres schema inside the window

**The rule** (ADR-155, widened to the floor; ADR-173): every release from the LTS floor
(`packages/upgrade/releases/lts-floor.json`, `3.20.1`) to head keeps running on every later schema.
The previous image serves on the new schema during the rollout and after a rollback, so every change
is expand/contract, and a destructive step may only remove what no release at or above the floor
reads or writes. Which recipe applies at all: the `migration` skill.

Files: `packages/prisma-client/prisma/schema.prisma` and
`packages/prisma-client/prisma/migrations/<timestamp>_<slug>/migration.sql`.

```bash
# Edit schema.prisma, then generate the SQL WITHOUT applying it, so you can shape it:
pnpm --filter @langwatch/prisma-client exec prisma migrate dev --create-only --config ./prisma.config.ts
# Apply it the way every entry point does (upgrade, then the system-migrations pass):
pnpm start:prepare:db
```

`--create-only` is not optional: Prisma generates the breaking form by default, and every recipe
below edits the SQL first. `pnpm prisma:migrate` still exists but bypasses the ledger, so the api
and worker keep refusing until `upgrade` runs; use `start:prepare:db`. The release PR stamps the
folder into a release manifest (`packages/upgrade/releases/<release>.json`); you never write one.

## The rules that never bend

1. **Never edit, rename or delete a merged migration.** The `migration-order` workflow refuses it
   and prints the `git checkout` that restores it (`specs/ci/migration-order.feature`).
2. **Key above main.** The folder's timestamp sorts above the newest folder on `origin/main`, not
   just your branch. Two PRs that pick the same key, or a key below main's newest, fail the check,
   which prints the `git mv` to a free key. Rebase, rename the folder, never reuse a key.
3. **One owner.** Every table the file touches belongs to one module (the one whose repository
   claims the model). `pnpm lint:architecture --policies migration-owners` refuses two; split the file.
4. **Unqualified table names.** `"Monitor"`, never `"langwatch_db"."Monitor"`.
5. **Every new column is nullable or has a `DEFAULT`.** Releases still serving do not name it.
6. **Re-runnable statements** (round 21): Prisma applies a migration statement by statement, so one
   cancelled by `lock_timeout` keeps its earlier statements. Every folder newer than the marker
   `RERUNNABLE_PRISMA_FROM` (`packages/upgrade/src/stepping/rerunnable-migrations.ts`) must survive a
   second run from its first statement; `pnpm lint:architecture --policies rerunnable-migrations`
   refuses anything else. Write `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
   `CREATE INDEX IF NOT EXISTS` (never `CONCURRENTLY` in the file), `DROP ... IF EXISTS`,
   `ADD VALUE IF NOT EXISTS`, `INSERT ... ON CONFLICT`, `CREATE OR REPLACE`; guard a constraint, a
   type or a rename with a `DO $$ ... $$` block that checks the catalogue. Prisma's generated SQL
   has none of these: edit it before you commit. Never move the marker back.
7. **Nothing is dropped while a release at or above the floor uses it**, and the statement carries
   `-- contract: retired in <release>` with `<release>` at or below the floor. A later release is
   refused (`retirement-note-above-floor`) with the first release it may ship in.
8. **Nothing is renamed or retyped in place.**
9. **No new foreign key and no new `@relation`** (Alex, 2026-10-06; existing ones stay).

## What the guard refuses, and what to write instead

Every finding prints its own fix. Source: `packages/prisma-client/src/__tests__/migration-safety.rules.ts`.
A table created in the same migration is empty, so the locking rules leave it alone.

| Rule                                               | Refuses                                                                            | Write instead                                                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `drop-without-retirement-note`                     | `DROP TABLE`, `DROP COLUMN` with no note                                           | the note, once the floor allows                                                                                 |
| `retirement-note-above-floor`                      | a note naming a release above the floor                                            | wait for the floor, or leave the drop out                                                                       |
| `add-not-null-column-without-default`              | `ADD COLUMN ... NOT NULL` with no `DEFAULT`                                        | a `DEFAULT`, or nullable now                                                                                    |
| `set-not-null-on-populated-column`                 | `ALTER COLUMN ... SET NOT NULL` on an existing table                               | app-level enforcement, or `CHECK (col IS NOT NULL) NOT VALID` then `VALIDATE` later; no escape hatch (round 22) |
| `alter-column-type`                                | `ALTER COLUMN ... TYPE`                                                            | new column, backfill, switch, retire the old                                                                    |
| `enum-recreated`                                   | `ALTER TYPE ... RENAME TO`, drop-and-recreate an enum                              | `ALTER TYPE ... ADD VALUE`; never remove a value                                                                |
| `unique-or-validated-constraint-on-existing-table` | `ADD UNIQUE`/`PRIMARY KEY` built at once, `CHECK` validated at once                | pre-build the index and `ADD CONSTRAINT ... USING INDEX`, or `NOT VALID` + a later `VALIDATE`                   |
| `plain-index-on-existing-table`                    | `CREATE INDEX` on an existing table with no pre-build note                         | the ops pre-build note (below)                                                                                  |
| `rename-in-place`                                  | `RENAME COLUMN`, `ALTER TABLE ... RENAME TO`                                       | add, backfill, dual-write, switch, retire                                                                       |
| `new-foreign-key`                                  | `FOREIGN KEY` or a `REFERENCES <table>(...)` clause, on a new or an existing table | a plain column with an index (below); new `@relation` lines are held by the enforcer's `prisma-relations` list  |

**The ops pre-build note.** `CONCURRENTLY` cannot run inside Prisma's transaction, so an index on an
existing table carries a comment naming the statement an operator runs ahead; the migration's own
`IF NOT EXISTS` then finds it built. Exemplar:
`packages/prisma-client/prisma/migrations/20261006120000_process_outbox_lease_by_process_index/`.

```sql
-- ops pre-build: CREATE INDEX CONCURRENTLY IF NOT EXISTS "Widget_projectId_idx" ON "Widget" ("projectId");
CREATE INDEX IF NOT EXISTS "Widget_projectId_idx" ON "Widget" ("projectId");
```

A failed `CONCURRENTLY` build leaves an invalid index under that name that `IF NOT EXISTS` then skips;
say in the note to check `pg_index.indisvalid` and `DROP INDEX CONCURRENTLY` before retrying.
Sessions run with `lock_timeout` 10 s; a statement that waits longer fails the run, the old image
keeps serving, and the operator re-runs `upgrade`.

**A re-runnable migration, worked.** The shape the `rerunnable-migrations` policy accepts
(`packages/architecture-enforcer/src/policies/persistence/rerunnable-migrations.ts`, cases in
`packages/architecture-enforcer/tests/rerunnable-migrations.unit.test.ts`; the in-tree index
exemplar is the `20261006120000_process_outbox_lease_by_process_index` folder above). Every
statement is a no-op on its second run, in the order Prisma would apply them:

```sql
CREATE TABLE IF NOT EXISTS "ProjectWidget" ("id" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  CONSTRAINT "ProjectWidget_pkey" PRIMARY KEY ("id"));
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "slug" TEXT;
CREATE INDEX IF NOT EXISTS "ProjectWidget_projectId_idx" ON "ProjectWidget" ("projectId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Project_slug_present') THEN
    ALTER TABLE "Project" ADD CONSTRAINT "Project_slug_present"
      CHECK ("slug" IS NOT NULL) NOT VALID;
  END IF;
END $$;
```

The policy names the fix for each bare form (`a second CREATE TABLE fails: write CREATE TABLE IF NOT
EXISTS`, `a second INSERT duplicates its rows ...: add ON CONFLICT DO NOTHING`, `a cancelled concurrent
build leaves an INVALID index ...`); a statement it does not recognise is refused with the `DO $$`
guard as the fix. Prisma's generated SQL has none of these guards: edit it after `--create-only`.

## No foreign keys, no new `@relation`

The W-01 guard (`new-foreign-key`, merged in 0dece53e) refuses a new `FOREIGN KEY` or `REFERENCES` clause in
a migration and a new `@relation` in `schema.prisma`; existing ones stay. A reference is a plain scalar column with an index. Joins happen in the owning repository by a second
query; a table another module owns is never joined (ask its `*Api`). Deleting dependents is a
service's behaviour; children in another module go by a fact and that module's purge subscriber (§9.1).

```prisma
model ProjectWidget {
  id        String @id
  projectId String
  @@index([projectId])
}
```

## Recipes

**Add a column or table.** One release. `ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "slug" TEXT;`
or with `NOT NULL DEFAULT 'free'`. New writers set the new shape from this release: a fresh install
plans data steps by mode, so a backfill is never the only way a row becomes correct.

**Remove a column or table.** Release A stops reading and writing it, marked `/// retired: unread
since A` in `schema.prisma`, no migration. Once the floor is at or above A, drop it:

```sql
-- contract: retired in 3.20.1
ALTER TABLE "Project" DROP COLUMN IF EXISTS "legacyKey";
```

If a tenant step's legacy path reads it, archive-or-fail first (`migration-data-step`).

**Rename a column, or change its type.** Expand: the new column beside the old. Migrate: dual-write
from release A and copy (inline `UPDATE ... WHERE "new" IS NULL` for a small table, a background
`.withMigrations` step for a large one); readers switch in A or read `coalesce(new, old)`. Contract:
drop the old under rule 7.

**Make a column required.** Writers set it from release A; a step fills the gaps; enforce it in the
application. If the database must enforce it, add `CHECK ("slug" IS NOT NULL) NOT VALID` once the
floor is at or above A, and `VALIDATE CONSTRAINT` in a later migration. Never `SET NOT NULL`.

**A new unique constraint.** A plain index with the pre-build note; a step repairs duplicates;
writers comply from A; then a unique index pre-built the same way and attached with
`ADD CONSTRAINT ... USING INDEX`.

**Split a table.** Create the new table, dual-write and copy (a data step once it is large), switch
readers, retire the old columns under rule 7.

**Inline DML** (`UPDATE`, `INSERT`, `DELETE` in the migration) is the simplest blocking data step: it
runs at its own release against its own schema. Keep it small and copy, never move.

**A projection table** is derived state: create the new shape under its own name, replay it
(`packages/eventing/src/replay/`), switch readers, retire the old table under rule 7. Never `ALTER`.

## When it failed on deploy

A folder newer than the marker is re-runnable, so `upgrade` clears it itself: it marks the failed
row rolled back (`prisma migrate resolve --rolled-back`), waits the retry backoff (2 s, then 4 s) and
applies it again, up to 3 attempts, logging each by name (`Prisma migration <name> failed on attempt 1
of 3 and is re-runnable: marked it rolled back`). A failed row an earlier run left is cleared the same
way at preflight. Still failing after the last attempt, the run exits 1 with code
`rerunnable_migration_failed`: fix the cause (often a lock another session holds, `lock_timeout` 10 s)
and run `upgrade` again; no resolve command is needed.

A folder at or below the marker, or one the image does not ship, keeps the conservative path:
`upgrade` exits 1 with code `failed_prisma_migration` and names the command to clear it. Check what it left, then
`prisma migrate resolve --rolled-back <name>` if nothing remains, or `--applied <name>` if you
completed it by hand, then run `upgrade` again. Nothing has rolled; the old image still serves.
specs/upgrade/rerunnable-migrations.feature.

## The scanner

```bash
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/prisma-client test src/__tests__/migration-safety.unit.test.ts
```

It reads every folder not in `src/__tests__/migration-safety.baseline.txt` (frozen; adding yours is
refused) and fails by name with the fix. Folders merged from main are in
`migration-safety.from-main.txt` by blob sha. The six floor and lock rules (`FLOOR_AND_LOCK_RULES`)
hold only folders after the test's `NEW_RULES_FROM` marker. Spec: `specs/ops/migration-safety.feature`.
ClickHouse: the `clickhouse-migration` skill.
