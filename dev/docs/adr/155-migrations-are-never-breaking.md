# ADR-155: Migrations are never breaking

**Date:** 2026-09-23

**Status:** Accepted

## Context

Migrations are applied to the live database by tasks, before serve
(`pnpm prisma:migrate` / `pnpm clickhouse:migrate` through `@langwatch/tasks`,
ARCHITECTURE.md §7). On a rolling deploy that means there is always a window —
minutes on a large installation — in which the **previous** image is serving
against the **new** schema. And if the roll is reverted, the new schema outlives
the image that asked for it.

Nothing stated the consequence, so nothing enforced it. The tree carries the
evidence: 93 statements across the Prisma history and 67 across the ClickHouse
history are drops, in-place renames, bare `NOT NULL` additions, type changes or
variable-size columns added without a default. Each one was a deploy that only
worked because the order happened to fall the right way, or because the table
was empty, or because nobody rolled back that day.

Two more things were true and unwritten. Ordering was implicit: both the app and
the workers container run `start:prepare:db` on boot, so on a helm upgrade the
migration ran inside whichever new pod won the advisory lock, concurrently with
the old pods still serving — a failed migration became CrashLoopBackOff rather
than a stopped upgrade. And a projection table was treated like any other table,
although a projection is derived state whose record is the event stream.

## Decision

**A migration never breaks the image that is already running, and never strands
the image that replaces it. Deployment order cannot matter.**

Concretely, and each of these is a rule a reviewer can apply:

1. **Adding a column**: it is nullable or it has a `DEFAULT`. An `INSERT` from
   the image still serving does not name it.
2. **Removing a column, a table or a field**: only after the code stopped
   reading and writing it, and only in a migration shipped **one full release
   later** than that code. A rollback of the newest release must still find its
   schema. Until then the thing stays, documented as retired.
3. **Renaming**: never in place. Add the new name, backfill, dual-write or read
   both, switch the readers, then retire the old name under rule 2. There is a
   way back at every step.
4. **Constraints, type changes, `NOT NULL`**: the same expand → migrate data →
   contract shape, one step per release.
5. **ClickHouse**: one statement per goose `StatementBegin`/`StatementEnd` block
   (there is no multi-statement query); down migrations stay commented out under
   `To roll back, uncomment and run manually.`; a `MODIFY COLUMN` type change and
   any `DROP` are contract steps; a variable-size column added by `ALTER` carries
   a `DEFAULT`, because parts written before it are unmaterialised and decode as
   garbage without one (Code 173 at read, Code 241 at merge).
6. **Event-sourced projections**: a projection table change is a **rebuild, not
   an ALTER**. The rebuild runs beside the old projection — `ReplayService` in
   `packages/eventing/src/replay/` sets a per-projection cutoff marker and defers
   live events for an aggregate until its replay has passed them — and the
   readers switch only once it has caught up. The old projection is retired under
   rule 2.

A contract step says so in the SQL, above the statement:

```sql
-- contract: retired in 1.42.0
ALTER TABLE "Project" DROP COLUMN "legacyKey";
```

The note is not decoration. It records that a human checked the one-release
wait, and it names the release a reviewer can go and read.

### Why one full release, and not "the code no longer uses it"

Because the way back from a bad release is the previous image, and the previous
image is the one that still reads the column. A drop in the same release as the
code that stopped using it makes that release irreversible — which is exactly
the release most likely to need reversing. One release of overlap costs a dead
column for a few weeks and buys a rollback that works.

## The enforcement

**The scanner**, two unit tests, each in the package that owns its migrations,
each over a pure rules file beside it:

- `packages/prisma-client/src/__tests__/migration-safety.{rules,unit.test}.ts`
- `packages/clickhouse-migrations/src/__tests__/migration-safety.{rules,unit.test}.ts`

It reads every migration **not** in the committed baseline beside it and fails by
name, with the fix, on each rule above. Every message carries its own fix, the
way a lint message does — a scanner that only says "no" teaches nothing.

The baseline is the list of migrations already shipped when the scanner landed.
It is **frozen**: the baseline test refuses any entry sorting above a high-water
mark recorded in the test file, so extending it to silence a new finding takes
two deliberate edits in two files and is visible in review. Migration names sort
by time (Prisma) and by sequence (goose), which is what makes that checkable.

The rules are duplicated per package rather than shared, because a relative
import across package boundaries is refused by `langwatch/package-boundaries` and
neither package depends on the other. Collapsing them into one module is a
workspace dependency plus an install; it is worth doing and it is not urgent.

**The pre-roll gate**, `charts/langwatch/templates/app/migrate-pre-roll-job.yaml`:
a `pre-upgrade` hook Job on the new image, running `start:prepare:db` and nothing
else, before helm applies any Deployment. It is fail-closed — a migration that
fails stops the upgrade with the new image never rolled and the old one still
serving. It is `pre-upgrade` only: not `pre-install` (helm applies hooks before
the Secrets they read exist), and never `pre-rollback` (a rollback must not run
migrations — running the previous image on the migrated schema is precisely what
these rules guarantee). The containers keep their own `start:prepare:db`, which
becomes an idempotent second pass, so a first install, a non-helm install and
`docker compose` are unchanged. `app.migrations.preRoll: false` opts out.

**Still to land**: a CI job that boots the *base branch's* code against a
database migrated by the head branch — the direct test of rule 1 through 4,
rather than their syntactic shadow. It needs a live Postgres and ClickHouse, the
goose binary, and two checkouts, so it is specified here and built separately.

## Consequences

- A schema change costs more releases than it used to, and says so in the SQL.
  That is the price of a rollback that works.
- The 160 historical statements are baselined, not fixed. They are shipped; the
  rule is for what comes next.
- An operator reading a failed upgrade sees a Job that failed, not a pod that is
  restarting.
- Two skills teach the recipes: `.claude/skills/postgres-migration` and
  `.claude/skills/clickhouse-migration`.

Spec: `specs/ops/migration-safety.feature`.
