# ADR-173: Upgrades run on deploy, and the serving roster says when old writers are gone

**Date:** 2026-10-06

**Status:** Proposed

## Context

Cloud ships by gradual release, not by version (Alex, 2026-10-06, night, third,
`.claude/coordinator/rulings-2026-10-05.md`). Every merge to main publishes a
`git-<sha>` image that the private deploy pins (`.github/workflows/publish-docker-ecr.yml:4-9,94`).
There is no release number to order those images by, and during a rollout the
build being replaced keeps serving beside the new one for as long as the rollout
takes. A rollback puts the older build back on the newer schema.

ADR-155 already makes every migration safe for the image still serving: expand
first, contract only one full release later. Two questions it leaves open are the
ones a deploy without an operator has to answer by itself:

1. **Who runs the upgrade, and when.** The chart's pre-roll Job runs the migration
   tasks from the new image before any Deployment rolls, pre-upgrade only, never
   pre-rollback, one attempt (`charts/langwatch/templates/app/migrate-pre-roll-job.yaml:29-36,63-75`).
   Whether cloud's private deploy uses that Job is not known from this repository.
2. **When every old writer has stopped.** A background or tenant step that needs
   the old build gone (a backfill the old build would undo, a dual write it would
   miss) asks an operator today: `assertSystemMigrationLegacyWritersDrained` takes
   a `minimumWriterGeneration` typed by hand (`modules/ops/contract/src/ops-system-migration.ts:42-47`).
   On cloud nobody is there to type it.

The design is `dev/docs/plans/migrations-rethink-2026-10-06.md` with the deltas of
`dev/docs/plans/migrations-blitz-2026-10-06.md` section 4. This record adopts D1,
D2 and D8 of that plan.

## Decision

**Upgrades run on deploy with no operator. One model serves cloud and
self-hosted. Whether old writers are gone is computed from the serving roster, never typed.**

### 1. The deploy runs `upgrade` before anything rolls

The deploy runs `pnpm task upgrade` from the new image, to completion, before any
Deployment rolls, and never on a rollback. A failed run fails the deploy: no pod
has rolled, the old build keeps serving, and the expand-only blocking steps that
did apply are ones that build already tolerates. New pods refuse to serve until
every blocking step their image declares is `done` or `not-needed` (the serving
gate). Background steps run on the worker and need no deploy step. The contract
the private deploy must meet is `dev/docs/runbooks/upgrade-on-deploy.md`.

### 2. One model, keyed by step id (D1)

A step is identified by its id, never reused. What ran is the ledger, keyed by
step id (and by target for ClickHouse). Releases are manifests that group ids;
the steps not yet in a release form one virtual release, which is all a cloud
deploy ever is. Version enters only where a version exists: self-hosted stepping
across several releases, and the refusal below the LTS floor.

**Why cloud needs no version.** The safety predicate, that nothing an older
supported build reads is removed, is checked in CI against the declared floor
when the PR is written. So the deploy-time question is only "which ids are not in
the ledger yet", which is version-free. The two runtime questions that do depend on
what is running are "is this process current", answered by the image's own list
of declared steps, and "has every old writer stopped", answered by the serving roster.
Neither orders builds, so a `git-<sha>` image needs no number and nothing in the
mechanism branches on cloud.

**Where the ledger lives** (round 21). The ledger, the runner lease and the serving roster sit in
their own Postgres schema beside the installation's, `<installation schema>_upgrade_ledger`
(`public_upgrade_ledger` for a default install), so one installation schema keeps one ledger.
`upgrade` creates that schema and its tables first on every database, then takes its lease there;
Prisma's first deploy runs under the lease like any other step, because Prisma's own schema holds
no ledger table and its P3005 refusal of a non-empty, unrecorded schema never fires. A ledger an
earlier build kept in the installation's schema is copied in once, and the old tables stay.

### 3. The serving roster (D2)

Each serving process (api, worker) writes one row to the runner-owned
`_langwatch_serving_roster` table when it starts: process id, role, image
(release or `git-<sha>`), release (none on cloud), and the ids of the steps its
image declares. It refreshes the row on an interval and deletes it on a graceful
stop. A row not refreshed within the stale bound is dead. The database clock
stamps and judges every row, so skew between pods never enters the answer.

**Old writers are gone for step S when every live row declares S.** No live row at
all also answers yes. A rollback to an image that does not declare S writes a row
without S, so the answer turns back to no, and a step waiting on it waits again.
The row carries no tenant data.

The operator assertion stays, as an override for a process that cannot report.
`packages/upgrade/src/serving-roster` implements the predicate; the serving gate records
its roster entry at boot.

### 4. Contract steps wait for the LTS floor on cloud too (D8)

There is one tree and one window. A destructive step is allowed only if what it
removes is unread from the floor up (rethink 6.12), and cloud waits for the same
floor as self-hosted. There is no cloud-only early contract, so a cloud rollback
always lands within the window.

### 5. Rulings since the proposal (Alex, 2026-10-06, rounds 8 to 17)

Source: `.claude/coordinator/rulings-2026-10-06-rounds.md`. Each line is Alex's answer.

- **Kept as built** (round 11): one ledger keyed by step id and target (D1); the runner-owned
  serving roster table, with `minimumWriterGeneration` as an override (D2); the child table
  `_langwatch_upgrade_target` for per-target status (D4); the `withUpgradeGate` preamble step in
  `packages/process` for api and worker, which also writes its roster entry (D5).
- **Guards and gates** (round 12): the migration guard refuses lock-heavy shapes and sessions set
  `lock_timeout` (D6); all four CI gates stay (D7); contract steps wait for the floor on cloud too
  (D8); manifests and the floor live in `packages/upgrade/releases/` (D9).
- **Floor** (round 13): the first LTS floor is the newest release at merge (D10); collisions are
  handled by keys and the migration-order check, with no checksum file (D11); a serving process
  refuses to start below the ledger's floor, and level-triggered background steps re-run after a
  rollback and re-upgrade (Q-U5).
- **Who runs** (round 14): the framework runs; ops reads and requests (Q-U8, UP-3; the record's §7
  is amended). `imageSteps` is exported from the `@langwatch/upgrade` package root. Every step
  carries a required one-line description (Q-U11). Every ClickHouse target runs, then a failed
  target fails the release (S4-TARGETS).
- **Declaring steps** (round 15): a checkpoint is `{ resumeFrom, save({ report }) }`; upcasts are
  declared with `.withUpcasts` on the owning pipeline and recorded as their own `event-upcast` kind;
  step checks stay as built.
- **Upcasts** (round 16): ids read `upcast:<pipeline>:<stored type>` (UP-2); the rewrite copies and
  deletes originals at the floor (UP-4); a lint names drains older than one release (UP-5); a fresh
  install plans upcast steps by their mode.
- **The Upgrades surface** (rounds 8, 10, 13 and 17): six `OpsApi` reads (status, releases, steps,
  step, runs, run) over an ops service on the upgrade reader (U2-API), renamed to `ops.upgrade.*`
  with no aliases, a wire difference accepted (Q-U9); the runner raises a read hint the api relays,
  and the page refreshes on it without polling (U2-LIVE); platform operators only, no organisation
  surface (Q-U10). An empty ledger is an eighth state, "never upgraded" (U1-a); a run with no finish
  time reads Upgrading until the lease table lands (U1-b); the reader refuses with `HandledError`,
  `packages/upgrade` taking that dependency (U1-c); a refused upgrade is a failed run with
  `report.refused` (S3-REFUSED-RUN).
- **The run itself** (round 9): phases are written into the run report in a fixed shape the reader
  parses, with no new table (U2-PHASES); a serving process stops serving once its last good roster
  write is older than the stale bound, 60 s; a rollback is detected from the serving roster, an
  older image's live row after the last run reopening level-triggered background steps (S3-ROLLBACK).
- **Names and storage** (rounds 19 and 21): presence is renamed the serving roster
  (`_langwatch_serving_roster`, `ServingRoster*`), since presence names another product feature,
  still written through an injected repository on the database clock; the ledger moves to its own
  Postgres schema so it exists before Prisma's first deploy (S3-BOOTSTRAP).
- **Fleet and alerts** (round 10): cloud regions send the same usage report as self-hosted installs,
  so one fleet page shows both (Q-U6); a failed or held upgrade emails platform operators and shows
  the operator banner, with Slack only where ops' notifier is configured (Q-U7).

## Alternatives considered

- **Number cloud builds** (a build counter beside the `git-<sha>`). Ordering builds
  answers neither runtime question better than the declared step list does, and a
  revert deploy would order the wrong way.
- **Ask the orchestrator which images run.** It ties `upgrade` to Kubernetes, has
  no answer on `docker compose`, and knows images, not the steps each declares.
- **Keep the operator assertion on cloud.** Nobody is there to type the generation,
  and a typo releases a step while an old writer still serves.
- **Contract early on cloud.** Saves up to one LTS cycle of dead schema but makes a
  cloud rollback able to land below its own schema, and splits the window in two.

## Consequences

- A deploy is one `upgrade` run then a rollout; a failed run is a failed deploy
  with nothing rolled. No page drives cloud; the region's upgrades page reads.
- A crashed process looks live until its row is stale, so "old writers gone" is
  late by at most the stale bound. A graceful stop clears its row at once.
- A process whose refresh keeps failing drops out of the serving roster while still
  serving, and could release a step early. The serving gate stops serving once
  its last good roster write is older than the stale bound, 60 s (Alex,
  2026-10-06, round 9).
- Each process start adds one row and each interval one write. Dead rows stay
  until pruned; they never count as live.
- Dead columns live up to one LTS cycle on cloud (D8).
- Tenant pacing stays on enrolment (rethink 6.8): a deploy never paces tenants.

## Links

- `dev/docs/adr/155-migrations-are-never-breaking.md` (the window this extends)
- `dev/docs/plans/migrations-blitz-2026-10-06.md` sections 3.1, 3.3 and 4
- `dev/docs/plans/migrations-rethink-2026-10-06.md`
- `dev/docs/runbooks/upgrade-on-deploy.md`
- `specs/upgrade/cloud-automatic.feature`
