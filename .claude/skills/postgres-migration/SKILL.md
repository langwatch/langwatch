---
name: postgres-migration
description: "Change the Postgres schema without breaking any release still in the supported window: the expand/contract recipes for adding a column, removing one, renaming one, changing its type, making it NOT NULL, adding a unique index and splitting a table; the LTS-floor rule for every destructive step and the retirement note the scanner requires; no new foreign key and no new @relation (Alex, 2026-10-06; existing ones stay); where schema.prisma and packages/prisma-client/prisma/migrations live; the unqualified-table-name rule; why a merged migration is immutable; inline DML as the simplest blocking data step; and how an event-sourced projection table changes (a rebuild beside the old one, never an ALTER). Use whenever someone says 'add a field', 'drop that column', 'rename this table', 'make it required', 'add a relation', 'foreign key', '@relation', 'onDelete Cascade', 'write a migration', 'the migration failed on deploy', or a migration-safety test named their migration."
user-invocable: true
argument-hint: "<the schema change, or the migration name the scanner refused>"
---

# Change the Postgres schema inside the window

**The rule** (plan 6.12; Alex, N1): every release from the LTS floor to head must keep running on
every later schema. `upgrade` steps an installation release by release while the old pods keep
serving, so each intermediate schema has to suit them too. Every change is expand/contract, and a
destructive step may only remove what **no release at or above the LTS floor** reads or writes. An
LTS is named every six months (Alex, N4). The plan is
`dev/docs/plans/migrations-rethink-2026-10-06.md` (revision 4), cited as "plan 6.x"; ADR-155 is the
original ruling, widened from "one full release" to the floor. Which recipe applies at all: the
`migration` skill.

Files: `packages/prisma-client/prisma/schema.prisma` and
`packages/prisma-client/prisma/migrations/<timestamp>_<slug>/migration.sql`.

```bash
# Edit schema.prisma, then generate the SQL WITHOUT applying it, so you can shape it:
pnpm --filter @langwatch/prisma-client exec prisma migrate dev --create-only --config ./prisma.config.ts
# Apply it (today; the `upgrade` command replaces this at S3, plan 8):
pnpm prisma:migrate
```

`--create-only` is not optional: Prisma generates the breaking form by default, and every recipe
below edits the SQL before it is applied. You do not write a release into the migration; the release
PR stamps every new folder with the release being cut (plan 6.3).

## The rules that never bend

1. **Never edit a merged migration.** Its checksum is recorded and the `migration-order` workflow
   refuses the change (`specs/ci/migration-order.feature`). Write a new one.
2. **Unqualified table names.** `"Monitor"`, never `"langwatch_db"."Monitor"`: the schema comes
   from the connection string.
3. **Every new column is nullable or has a `DEFAULT`.** Releases still serving do not name it in
   their `INSERT`s.
4. **Nothing is dropped while a release at or above the LTS floor reads or writes it.** The note
   above the statement names the release whose code stopped using it:
   `-- contract: retired in <release>`. The scanner checks the note is there; checking `<release>`
   against the declared floor lands with S9 (plan 6.12, enforcement item 1).
5. **Nothing is renamed in place**, and no type is changed in place.
6. **No new foreign key and no new `@relation`** (Alex, 2026-10-06; existing ones stay). See below.

**No floor is declared yet** (S9). Until one is, write the expand and migrate halves and leave
every contract step out: whether a drop may ship is the coordinator's question, not a lane's.

## No new foreign keys, no new `@relation`

A reference to another row is a plain scalar column with an index, and nothing else:

```prisma
model ProjectWidget {
  id        String @id
  projectId String
  @@index([projectId])
}
```

- **No new `@relation` field, on either side.** The datasource runs `relationMode = "prisma"`, so a
  relation already creates no SQL foreign key; what it does create is a client-side join and a
  client-emulated `onDelete: Cascade`. Both go.
- **Joins happen in the owning repository**, by a second query over its own tables. A table another
  module owns is never joined at all (CLAUDE.md, rule 2): ask its `*Api`.
- **Deleting dependents is behaviour, so it lives in a service**: the owning service deletes its
  own children explicitly; children in another module go by a fact and that module's purge
  subscriber (§9.1).
- **No `ADD CONSTRAINT ... FOREIGN KEY`** in a new migration. No scanner rule refuses it yet.

The tree's existing `@relation` fields and foreign keys stay as they are (Alex, 2026-10-06): do not
remove them as a side task. The rule binds new models and new references only.

## Recipe: add a column

One release. Nullable, or with a `DEFAULT` (instant in Postgres 11 and later: the default lives in
the catalogue, no rewrite).

```sql
ALTER TABLE "Project" ADD COLUMN "slug" TEXT;
ALTER TABLE "Project" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'free';
```

New writers must set the new shape from this release on: a fresh install marks every historical
data step `not-needed` (plan 6.4), so a backfill is never the only way a row becomes correct.

## Recipe: remove a column or a table

- **Release A**: stop reading and writing it. Leave it in `schema.prisma` marked
  `/// retired: unread since A`. No migration.
- **The first release whose LTS floor is at or above A**: remove it from `schema.prisma` and drop
  it, with the note.

```sql
-- contract: retired in 1.42.0
ALTER TABLE "Project" DROP COLUMN "legacyKey";
```

If a tenant step's legacy path reads the source, the drop archives the still-held tenants first
(archive-or-fail, the `migration-data-step` skill).

## Recipe: rename a column, or change its type

1. **Expand**: add the new column (new name or new type), nullable, beside the old.
2. **Migrate**: dual-write from release A, and copy old to new. A small table copies in the same
   migration (`UPDATE "Project" SET "displayName" = "name" WHERE "displayName" IS NULL;`); a large
   one is a blocking frozen-SQL step or a background step (the `migration-data-step` skill). Readers
   switch in A, or read `coalesce(new, old)` to collapse the steps.
3. **Contract**: drop the old column under rule 4.

## Recipe: make a column NOT NULL

1. **Expand**: the column exists with a `DEFAULT`, or nullable.
2. **Migrate**: every writer sets it from release A; a step fills the gaps.
3. **Contract**: once the floor is at or above A, a migration that repeats the fill and sets it:

```sql
UPDATE "Project" SET "slug" = "id" WHERE "slug" IS NULL;
ALTER TABLE "Project" ALTER COLUMN "slug" SET NOT NULL;
```

The `UPDATE` guards rows written between the fill and the lock, and is what the scanner looks for.
`SET NOT NULL` on a populated column counts as destructive under the floor (plan 6.12, enforcement
item 2; the scanner's check widens at S9).

## Recipe: a new unique constraint

Add a non-unique index first; a step repairs the duplicates; writers comply from release A; make it
unique once the floor is at or above A. An immediate unique index fails on any duplicate an older
release writes.

## Recipe: split a table

The same expand/contract, one table wider: create the new table (nothing reads it); dual-write and
copy the old rows (a data step once the table is big enough that a migration would hold a lock);
switch the readers; retire the old columns under rule 4. The new table carries plain id columns,
no foreign key.

## Inline DML is the simplest blocking data step

An `UPDATE`, `INSERT` or `DELETE` inside a Prisma migration stays allowed (plan 6.11): under stepping
it runs at its own release, against its own release's schema. Keep it small (it runs inside the
migration's lock) and copy, never move. Anything larger is the `migration-data-step` skill.

## Event-sourced projections are rebuilt, not altered

A projection table is derived state (§9). A change to its shape is a rebuild beside the old one,
never an `ALTER`: create it under its own name, replay it with `ReplayService`
(`packages/eventing/src/replay/`), let it catch up while the old one serves, switch the readers,
retire the old table under rule 4 (ADR-155 rule 6). The fold must be idempotent: the rebuild may run
twice. A rebuild a release needs becomes a background data step (plan 6.1, K6).

## The scanner

```bash
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/prisma-client test src/__tests__/migration-safety.unit.test.ts
```

It reads every migration folder not in `src/__tests__/migration-safety.baseline.txt` and fails by
name, with the fix: a drop without the note, a new `NOT NULL` column without a default,
`SET NOT NULL` without an `UPDATE` beside it, a rename in place. The baseline is **frozen**; adding
your migration to it is refused by the baseline test. Migrations merged from main are listed in
`migration-safety.from-main.txt` by blob sha and skipped while they match.

Spec: `specs/ops/migration-safety.feature`. ClickHouse: the `clickhouse-migration` skill.
