# `enrolledAutomatically` is implemented, declared nowhere, and asserted anyway

Needs a decision that is not a test author's to make. Recorded rather than
guessed at.

## What is true today

The mechanism is complete. `SystemMigrationsService` reads
`migration.enrolledAutomatically` in four places — it skips the enrollment
read, admits every organization to the cohort, refuses an explicit enrollment
as meaningless, and reports the migration as unpaced. `runtime.ts` threads it
into the cohort. `errors.ts` explains it.

**No migration sets it to `true`.** Every declaration in the tree is
`readonly enrolledAutomatically = false`, on the three identity migrations
(`identifier-backfill`, `secret-heal`, `connection-grandfather`). Nothing else
declares the field at all.

## What the tests assume

`runtime-enrollment.unit.test.ts` has two scenarios under "when the migration
declares itself enrolled automatically". Both name `AUTHZ_ENGINE_MIGRATION_NAME`
(`"authz-engine"`) as the migration that declares it, and one says so in a
comment: *"The registered authorization-engine migration is the one that
declares it."*

It is not registered among those migration classes, and it does not declare it.
So both fail, asserting `true` and getting `false`.

The five other failures in that file were an absent mock and are fixed. These
two are not that.

## The three ways out, and why this is a decision

1. **`authz-engine` should be automatic** — someone intended it and the
   declaration was lost or never landed. Then the fix is one line on that
   migration, and it changes WHO gets migrated on the next pass of a live
   rollout. That is not a change to make on a test's say-so.
2. **`authz-engine` should stay paced**, and the tests picked the wrong
   example. Then they should register their own migration declaring the flag
   and assert the mechanism, rather than couple a mechanism test to whichever
   real migration happens to carry it. The spec supports this reading — it says
   "a migration declared enrolled automatically", never naming one.
3. **Nothing should be automatic**, and the flag is dead. Then it and its four
   branches come out, and the two scenarios go with them.

The spec (`specs/migration/system-migrations-runner.feature:118-131`) describes
the mechanism generically and does not settle it.

Reading (2) is what the spec's wording supports and the safest of the three:
it fixes the tests without touching a rollout. But (1) is the one that matters
if someone meant `authz-engine` to be automatic, because right now it silently
is not — and that is the question worth answering first.

## Related

The authz rollout has form for this shape: see [[authz-migration-restages-every-boot]]
and [[migration-enrolment-vs-state-counters]].
