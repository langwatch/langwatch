# Upgrades: one concept and its UI flow (plan for Alex, 2026-10-06)

Status: proposal; no code has changed. Section 11 lists the decisions it needs.
Ruling it answers: Alex, 2026-10-06 afternoon, item 4 (`.claude/coordinator/rulings-2026-10-05.md:238`):
"build a whole UI flow around upgrades and migrations, simplifying and merging the machinery into one
concept where possible, useful for both cloud and self-hosted".
Builds on: `dev/docs/plans/migrations-rethink-2026-10-06.md` (revision 4, cited here as "plan 6.x"),
whose mechanism is ruled. This document designs the surfaces over that mechanism; it changes none of
its rules. Where it needs a rule the plan does not have, it asks (section 11).

## 0. Summary

1. **One concept: an upgrade.** An installation moves from the release it is on to the release its
   image carries. An upgrade is made of **steps**, every step has a **mode** (blocking, background,
   operator), and every step is a row in one ledger (plan 6.1, 6.6). Today's system migrations,
   enrolment, backfills, release-needed replays, storage moves and schema migrations all become
   steps; ad-hoc replays, dead letters, blob cleanup and the checkup stay what they are, and link in.
2. **One page, `/ops/upgrades`**, replaces `/ops/migrations`: where this installation stands, what
   each release did, what is still running, which tenants are held, and what an upgrade to a later
   release would do. Platform tier, as Ops is today (record §3.5, "Ops and Cloud admin are split").
3. **The page never runs the blocking part.** Changing the image is the operator's act (Helm,
   compose, npx); the pre-roll Job or first boot runs `upgrade` (plan 6.7, Q5, Q10). The page shows,
   previews, and runs only background re-runs, operator procedures and per-tenant actions, all of
   which the worker executes.
4. **One fleet view for LangWatch staff, `/ops/cloud/installations`**: self-hosted installs (their
   usage report already carries release, chart version and migration health) and, if Alex agrees,
   LangWatch's own cloud regions reporting the same way.
5. **The CLI prints what the page shows**: `pnpm task upgrade status | plan | run | tenants`, reading
   the same reader in `packages/upgrade`, as `langwatch doctor` prints the checkup's rows today.
6. Nine UI slices (section 10), U1 after the plan's S2; eleven questions (section 11), the largest
   being per-dataplane ClickHouse schema (Q-U1), where the latest release is learnt (Q-U3) and the
   name (Q-U2).

## 1. What exists today

| Surface                                 | What it does                                                                                                                                                                     | Evidence                                                                                                                                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ops > Migrations (`/ops/migrations`)    | lists registered tenant migrations with Finalized/Held/Parked/Rolled-back counts; cloud enrolment (one org, a cohort), targeted run, pass, drain assertion, per-tenant roll back | `modules/ops/browser/src/features/migrations/ui/sections/migrations-content.tsx:84-320`; procedures `modules/ops/process/src/transport/ops-platform.trpc.ts:97-198`         |
| Same page on main                       | the ancestor (1,099 lines; this branch's is 981)                                                                                                                                 | `origin/main:platform/app/src/components/ops/migrations/MigrationsContent.tsx`                                                                                              |
| Projections replay wizard and progress  | operator rebuilds projections for tenants since a date; one running at a time; history                                                                                           | `modules/ops/contract/src/ops-replay.ts:7-41`; screens `pages/ops/event-sourcing/projections`, `pages/ops/projections/[runId]` (`modules/ops/browser/src/ops.web.ts:47,75`) |
| Blob store cleanup                      | operator cleanup of stored payloads                                                                                                                                              | `ops-platform.trpc.ts:52-90`                                                                                                                                                |
| Checkup (`/settings/checkup`)           | self-hosted wiring rows incl. `postgres_migrations` and `clickhouse_migrations`; the install row names the release; readable by platform operators and org managers              | `modules/ops/contract/src/checkup.ts:23-50`; `modules/ops/specs/checkup-audience.feature:1-8`; `specs/self-hosting/checkup/checkup.feature:30-34,53`                        |
| Usage report                            | a self-hosted install reports `version`, `chart_version` and, per migration, parked and rolled-back counts                                                                       | `modules/ops/contract/src/usage-report.ts:67,81,600`                                                                                                                        |
| Cloud admin > Self-hosted installs      | the cloud's list of reporting installs with `version`, `chartVersion`, `lastSeenAt`                                                                                              | `modules/ops/contract/src/self-hosted-instance.ts:9-20`                                                                                                                     |
| `langwatch doctor` (SDK CLI)            | prints the checkup rows over `/api/checkup`                                                                                                                                      | `sdks/typescript/src/cli/commands/doctor.ts`; `checkup.screen.tsx:2-3`                                                                                                      |
| `npx @langwatch/server` start, doctor   | start migrates (Prisma, goose only); doctor checks predeps                                                                                                                       | `apps/server/src/cli.ts:70,189`; `apps/server/src/services/migrate.ts:53,60`                                                                                                |
| Helm pre-roll Job, stored-objects hooks | `start:prepare:db` before rollout; drain hooks keep workers off the shared volume                                                                                                | `charts/langwatch/templates/app/migrate-pre-roll-job.yaml`; `.../stored-objects-serialize-upgrade.yaml`                                                                     |
| Module tasks                            | manual backfills, the storage move, recovery tasks, `pnpm task <name>`                                                                                                           | plan 3.2 K4, K7                                                                                                                                                             |
| Docs                                    | "Check the migration results" sends operators to Ops > Migrations                                                                                                                | `docs/self-hosting/upgrade.mdx:43-50`                                                                                                                                       |
| `packages/upgrade` (S1, in progress)    | ledger schemas: step kind, mode, status; run kind and outcome; seed from `_prisma_migrations` and the shared ClickHouse's `goose_db_version`                                     | `packages/upgrade/src/ledger.ts`, `apps/tasks/src/upgrade-ledger-seed.ts` (untracked, lane `migrations-s1-ledger-2`)                                                        |

Two gaps the UI exposes that the plan does not cover:

- **ClickHouse schema is per dataplane.** `clickhouse-migrate` applies goose to the shared server and
  then to every private endpoint (`packages/clickhouse-migrations/src/clickhouse-migrate.task.ts:157-163`),
  each with its own `goose_db_version`; one failing endpoint fails the whole run (`:195-204`). The
  ledger has one row per step id and the seed reads only the shared server
  (`upgrade-ledger-seed.ts:19-24`). Question Q-U1.
- **"Upgrade" already means a plan upgrade** in the product (`UpgradeModal`, plan-limit cards,
  `upgrade_url` in refusals). Question Q-U2.

## 2. The concept

| Word             | Meaning                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Installation** | one ledger: one Postgres with its ClickHouse dataplanes. A self-hosted install, an npx install, a dev stack, one cloud region (inference: one Postgres per region).                  |
| **Release**      | a version with a manifest of step ids (plan 6.3); cloud deploys an unreleased set as one virtual release.                                                                            |
| **LTS floor**    | the oldest release this image upgrades from; one named every six months (Alex, N4).                                                                                                  |
| **Upgrade**      | one run of the runner from the installed release to the image's release (`_langwatch_upgrade_run`), plus the background work it leaves for the worker.                               |
| **Step**         | one ledger row: id, kind, release, mode, status (plan 6.1, 6.6; `packages/upgrade/src/ledger.ts`).                                                                                   |
| **Mode**         | blocking (inside `upgrade`), background (worker, after the last release), operator (on request, with arguments).                                                                     |
| **Tenant step**  | a background step whose progress is per organization, read from the owner's state port (plan 6.8). Its tenants are finalized, held (proof or pending), failed, rolled back or gated. |
| **Target**       | where a schema step applies: Postgres, or one ClickHouse dataplane (only if Q-U1 says yes).                                                                                          |

The user-facing sentence: "LangWatch is on 3.20.1. Your image is 3.23.0. Upgrading runs 14 steps
across three releases; three continue in the background; two organizations are held."

## 3. Concept merge

| Today's notion                                                              | Becomes                                                                                                                 | Why                                                                                                                                   |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma migrations (K1)                                                      | step, `postgres-schema`, blocking                                                                                       | plan 6.1                                                                                                                              |
| goose migrations (K2)                                                       | step, `clickhouse-schema`, blocking, per target (Q-U1)                                                                  | plan 6.1; dataplanes, section 1                                                                                                       |
| System (tenant) migrations (K5)                                             | step, `tenant`, background                                                                                              | plan 6.1, 6.8                                                                                                                         |
| Enrolment, cohorts, targeted run                                            | **properties and actions of a tenant step** (its pacing), not a page of their own                                       | enrolment only exists to pace one tenant step on cloud (`ops-system-migration.ts:85-110`); self-hosted shows "nothing to enrol" today |
| Drain assertion (`assertSystemMigrationLegacyWritersDrained`)               | an action on a held-pending tenant of a tenant step                                                                     | it is per tenant and per step (`ops-system-migration.ts:44-49`)                                                                       |
| Manual backfills (K4), dataset content backfill                             | step, `data`, background; an operator re-run with dry run                                                               | plan 6.1, 6.5 point 3                                                                                                                 |
| goose comment backfills                                                     | step, `data`, background (`MATERIALIZE`)                                                                                | plan 6.12                                                                                                                             |
| A projection rebuild a release needs (K6)                                   | step, `data`, background, whose run function starts a replay; the step drawer links to the replay progress screen       | one run engine (`ReplayService`), two reasons to run it                                                                               |
| Storage provider move (K7)                                                  | step, `procedure`, operator: plan, copy, finalize, verify as phases                                                     | plan 6.1; `specs/migration/object-storage-provider-migration.feature:40-62`                                                           |
| One-time latches (K8)                                                       | step, `data`, background                                                                                                | plan 6.1                                                                                                                              |
| Checkup's two migration rows                                                | **one source**: both rows read the ledger (outstanding blocking steps per kind), ids unchanged                          | the checkup and `upgrade status` must not disagree; `langwatch doctor` matches on the ids                                             |
| Usage report's migration health                                             | the same section widened to the ledger's summary (installed, image, floor, failed steps, held tenants, oldest held age) | the fleet view reads it (section 6.2)                                                                                                 |
| Stays separate: reconcilers (TTL, LWQL, access config)                      | the last phase of every upgrade run, shown as one line with its outcome, not steps                                      | convergent, release-free (plan 3.2 K3)                                                                                                |
| Stays separate: ad-hoc replays, dead letters, process redrives              | event-sourcing tools under `/ops/event-sourcing`                                                                        | runtime repair, not attached to a release                                                                                             |
| Stays separate: blob cleanup, process-manager purge, operator recovery task | tasks and ops tools                                                                                                     | repeatable maintenance, not attached to a release                                                                                     |
| Stays separate: checkup                                                     | wiring health; links to `/ops/upgrades` from its migration rows                                                         | answers "is this install wired", not "what release is it on"                                                                          |
| Stays separate: feature flags                                               | release flags (record §3.5); a tenant step's cloud pacing is enrolment, never a flag                                    | four capability layers each have one owner                                                                                            |
| Stays in the chart: stored-objects drain hooks                              | infrastructure choreography; named in the plan preview's preflight                                                      | they move pods, not data                                                                                                              |

The test for "step or tool": a step exists because a release changed something and is recorded once
per installation; a tool exists because of runtime state and can run any number of times.

## 4. States the UI shows

**Installation state** (one, computed by the reader, top of every screen and of `upgrade status`):

| State                   | When                                                                                                   | Tone    |
| ----------------------- | ------------------------------------------------------------------------------------------------------ | ------- |
| Up to date              | ledger release = image release, no step failed, no background pending                                  | neutral |
| Finishing in background | blocking done; background or tenant steps pending or running                                           | info    |
| Upgrading               | a run holds the lease (plan 6.7)                                                                       | info    |
| Behind                  | the image is newer than the ledger: new pods refuse to start (plan 6.7). Read from the old pods' page. | warning |
| Rolled back             | the image is older than the ledger's release and at or above the ledger's floor (section 6.1.6)        | warning |
| Unsupported             | the installed release is below the floor, or the image is below the ledger's floor                     | danger  |
| Needs attention         | a failed step, a failed target, or a tenant held past the threshold                                    | danger  |

**Step status**: the ledger's six (`pending`, `running`, `done`, `not-needed`, `failed`, `gated`),
labelled "Waiting", "Running", "Done", "Not needed (fresh install)", "Failed", "Not enabled here".
**Tenant state**: Finalized, Held: proof disagreed, Held: work not drained, Failed, Archived, Rolled
back, Not enrolled (cloud). "Parked" today becomes Failed (plan 6.8 splits `migrated`; parked already
means a thrown error).

## 5. Audiences and permissions

| Audience                                                           | Where                      | Reads                                                                    | Writes                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance operator (self-hosted or cloud staff on one installation) | `/ops/upgrades/**`         | `ops:view` at platform                                                   | `ops:manage` at platform; destructive actions also need a real signed-in operator and a typed confirmation, as today (`ops-platform.trpc.ts:2-4`) |
| LangWatch staff, across installations                              | `/ops/cloud/installations` | the ops gate plus cloud ops (record §3.5)                                | none on a remote install (it is not ours to drive)                                                                                                |
| Organization manager                                               | `/settings/checkup` only   | the two migration rows' verdicts, details per `checkup-audience.feature` | none                                                                                                                                              |
| Organization member                                                | nothing                    | a refused feature stays opaque (record §3.5, "Off is opaque")            | none                                                                                                                                              |

Self-hosted always has an operator: the bootstrap grants `ADMIN_EMAILS` or the oldest org admin of a
one-organization install (record §7, "Operator bootstrap"). No new permission is proposed.

## 6. Flows

### 6.1 Self-hosted admin

1. **What am I on?** Ops > Upgrades shows installation state, installed release, image release, LTS
   floor, origin release, last run, and "latest available" if Q-U3 allows. The checkup's migration
   rows say the same in one line and link here.
2. **What will an upgrade do?** "Preview an upgrade": pick a target (the release feed, Q-U3, or typed).
   The preview needs the target's manifests, which this image lacks; it reads them from the published
   manifest (Q-U3), else it says so and prints the command that asks the new image itself:
   `docker run --rm <image>:<target> pnpm task upgrade plan` with this install's connection, which
   prints the same preview. The preview lists: the releases stepped through; per release its schema
   counts, blocking steps (with the step's size estimate when it declares one), background and tenant
   steps, operator procedures it requires; destructive steps and what they retire; tenants held on a
   step whose source is retired (archive-or-fail, plan 6.8); and the preflight.
3. **Preflight** (rows in the checkup's verdict shape, `checkup.ts:137-156`: verified, refused,
   unchecked): installed release at or above the target's floor; no failed Prisma migration
   (plan 6.11); no live lease; every dataplane reachable; object storage configured where a step
   needs it; recent backup (unchecked, always: we cannot tell; it states the docs link); the
   stored-objects drain hooks for Helm with a shared volume. Refused rows name the fix.
4. **Run.** The page shows the command for this deployment kind (Helm, compose, npx, read from the
   install's deployment fact), never a Run button for the blocking part. While the pre-roll Job runs,
   the old pods keep serving (plan 6.7), so the page polls the ledger and shows the run live: per
   release, Postgres schema, ClickHouse schema per target, blocking steps, then reconcile. Compose and
   npx have no old pods: progress is the `migrate` service log or the CLI panel (Q-U4 asks for a
   holding page).
5. **After.** "Finishing in background" with one meter per background step and a tenant gauge per
   tenant step. Failed steps and held tenants sit at the top under "Needs attention". Each tenant row
   offers: run again for this organization, roll back to the legacy path, assert drained (held
   pending), view the proof report. A failed data step offers "Run again" and "Dry run".
6. **Roll back.** No down migrations (plan 1). Rolling back is redeploying the previous image: every
   release at or above the floor runs on the newest schema (plan 6.12). The page then says "Rolled
   back: running 3.20.1 on 3.23.0's schema; supported because 3.20.1 is at or above the floor 3.19.0".
   Below the floor it says "Unsupported" and names the floor. Serving processes from S3 on refuse when
   their release is below the ledger's floor (proposal, Q-U5). Re-upgrading re-runs level-triggered
   background steps whose sources old pods may have written to (plan 6.12 "Data step"): the reader
   marks them `pending` again after a run follows a rollback (Q-U5). Per-tenant roll back stays.
7. **Held and archive-or-fail.** "Held organizations" lists every tenant not finalized across steps:
   organization, step, state, held since, age, and "archived at" (the release that retires the step's
   source, or "next LTS" when unknown). Past the threshold the row is Failed and alerted (Q7).
   Archived tenants show the retained `_retired_<table>` name and the LTS when the archive itself goes
   (plan 6.8). Nothing on this screen blocks anything.

### 6.2 Cloud operator

1. **One region** is one installation: its own `/ops/upgrades`, with enrolment and cohorts on each
   tenant step (today's page, moved), and a **Dataplanes** tab: shared ClickHouse and each private
   endpoint by label and organization, never its URL (URLs carry credentials, record §7), with goose
   version, behind, failed (Q-U1).
2. **The fleet**: `/ops/cloud/installations` lists every installation that reports: self-hosted
   installs (today's Self-hosted installs list, widened) and cloud regions if they report too (Q-U6).
   Columns: name, kind (cloud region, Helm, compose, npx), release, chart version, floor, state,
   failed steps, held tenants, oldest held age, last report. Filter "below the floor", "behind",
   "needs attention". A row opens the installation drawer: the report's upgrade section and its
   history. Read-only: a remote install is not driven from here.
3. **Alerts.** The worker's scheduled process manager (`ops-system-migrations.pipeline.ts:66`, hourly)
   raises: step failed, target failed, tenant held past threshold, run failed or lease expired,
   installation behind for longer than a deadline. Channels: the step metrics (plan 6.10) for
   Grafana; ops' Slack notifier where configured (the bug-report channel's pattern); and an email to
   platform operators through `NotificationApi.sendEmail`, an edge ops already has
   (`modules/ops/process/src/app/ops.app.ts:49`). Self-hosted gets the email and an operator banner
   (Q-U7).

### 6.3 CLI equivalents

One reader in `packages/upgrade`; the CLI and the page print the same facts. `--json` everywhere.

| Page action                  | Command (in the image: `kubectl exec`, `docker compose exec`, the npx CLI)            |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| Installation state           | `pnpm task upgrade status`                                                            |
| Preview to a target          | `pnpm task upgrade plan [--to <release>]` (from the target image, section 6.1.2)      |
| Run the upgrade              | `pnpm task upgrade` (the pre-roll Job, compose `migrate`, npx start run this)         |
| Re-run a data step, dry run  | `pnpm task upgrade run <step-id> [--dry-run]`                                         |
| Operator procedure phase     | `pnpm task upgrade run <step-id> <phase> [args]`                                      |
| Held organizations           | `pnpm task upgrade tenants [--step <id>] [--state held]`                              |
| Tenant: run again, roll back | `pnpm task upgrade tenant <step-id> <organizationId> run`, `... roll-back`            |
| Checkup migration rows       | `langwatch doctor` (remote), `npx @langwatch/server doctor` (local, gains the status) |

The npx CLI's install panels (`apps/server/src/cli.ts:131-150`) gain an "Upgrading 3.20.1 to 3.23.0"
panel with the same phases as the run screen.

## 7. Screens

All under ops' browser, `modules/ops/browser/src/features/upgrades/` (replacing `features/migrations/`),
in the `PageLayout` shell the other ops screens use. Components are from `@langwatch/design-system`
(no Chakra in modules, record §2). Settings-menu entry "Upgrades" replaces "Migrations"
(`modules/navigation/browser/src/model/settings-menu.ts:323`); `/ops/migrations` redirects.

**W1 Overview** `pages/ops/upgrades`, `/ops/upgrades`, requires `ops:view`.

- Header: `PageLayout.Heading` "Upgrades"; state `Badge`; `CopyButton` on the release.
- Strip of `stat-tile`: Installed, Image, LTS floor, Last run (outcome and duration).
- `Alert` "Needs attention" when anything failed or is held past threshold, each line a link.
- "Releases": `ListTable`, one row per release from origin to image: release, date applied, steps
  (`Badge` counts by status), background `meter-bar`. A row opens W2.
- "Background work": rows per pending or running background and tenant step with `meter-bar`.
- "Recent runs": `ListTable` of runs with outcome, image, started, duration; a row opens W4.
- Button "Preview an upgrade" (W5). Empty state (`no-data-info-block`) before the ledger exists:
  "This installation has not recorded an upgrade yet".
- Reads: `ops.upgrade.status`, `ops.upgrade.listReleases`, `ops.upgrade.listRuns`.

**W2 Release** `pages/ops/upgrades/releases/[release]`, requires `ops:view`.

- Steps `ListTable` grouped by mode (`Accordion` sections Blocking, Background, Operator): id, owner
  module, kind, status `Badge`, attempts, duration, last error (`overflown-text`). Link to the
  release notes. A row opens W3.
- Reads: `ops.upgrade.listSteps({ release })`.

**W3 Step drawer** `?drawer.open=upgradeStep&step=<id>` (a routed singleton drawer, `drawer`).

- Header: id, kind, mode, release, owner; status; attempts; timestamps.
- Last error with its fix; checkpoint report in ops' `JsonViewer`.
- Schema step with targets: per-target `ListTable` (Q-U1).
- Tenant step: status `Badge` counts (today's `MigrationStatusBadges`), pacing (enrolled
  automatically, gated on self-hosted, enrolment gauge on cloud), held tenants table, enrol one,
  enrol cohort (today's dialogs, moved), run pass.
- Data step: Run again, Dry run (`ops:manage`; `confirm-dialog`), replay link when replay-backed.
- Procedure step: phases as a vertical list with each phase's status and arguments form
  (`horizontal-form-control`), Run phase (`ops:manage`, typed confirmation where destructive).
- Reads `ops.upgrade.getStep`; writes `ops.upgrade.runStep`, `ops.upgrade.runTenant`,
  `ops.upgrade.rollBackTenant`, `ops.upgrade.assertTenantDrained`, `ops.upgrade.enrollTenant`,
  `ops.upgrade.enrollCohort`, `ops.upgrade.withdrawTenant`.

**W4 Run** `pages/ops/upgrades/runs/[runId]`, requires `ops:view`.

- Phases: preflight, then per release (Postgres schema, ClickHouse schema per target, blocking
  steps), then reconcile, as a vertical list with `Status` dots and durations; the plan the run
  printed (`JsonViewer`); polls while running (record §10.2 read hints or polling).
- Reads `ops.upgrade.getRun`.

**W5 Preview** `pages/ops/upgrades/preview`, requires `ops:view`.

- Target `select` (release feed) or input; the plan (section 6.1.2) as `Accordion` per release;
  "Destructive" and "Archive-or-fail" `Alert`s; preflight rows reusing the checkup's `CheckRow`
  shape (moved to a shared element in ops); the command for this deployment kind in `Code` with
  `CopyButton`. When manifests cannot be fetched: the command that previews from the new image.
- Reads `ops.upgrade.preview({ to })`.

**W6 Held organizations** `pages/ops/upgrades/organizations`, requires `ops:view`.

- `ListTable` with `pagination`: organization, step, state, held since, age, archived at; filters
  (`filter-chips`) by step and state; `search-input` by organization (today's picker). Row actions as
  W3's tenant actions.
- Reads `ops.upgrade.listTenants`.

**W7 Dataplanes** tab of W1 (only when private endpoints exist, Q-U1): label, organizations, goose
version, outstanding, last error. Reads `ops.upgrade.listTargets`.

**W8 Fleet** `pages/ops/cloud/installations` (cloud admin, record §3.5), replacing
`/ops/cloud/self-hosted-instances` with a redirect; `ListTable`, `filter-chips`, installation drawer.
Reads the self-hosted instance registry widened with the report's upgrade section.

**W9 Operator banner** in the shell for platform operators when the state is Behind, Unsupported or
Needs attention, beside ops' impersonation banner (`modules/ops/browser/src/ui/sections/impersonation/`),
linking to W1. Reads `ops.upgrade.attention` (`ops:view`, cheap, cached).

**W10 Checkup rows**: `postgres_migrations` and `clickhouse_migrations` read the ledger; their fix
names `pnpm task upgrade` and links `/ops/upgrades` for operators.

## 8. Reads, writes and what `packages/upgrade` exposes

**Ops' transport.** The procedures above are ops' own tRPC procedures under `ops.upgrade.*`, each with
`.withPermission("ops:view" | "ops:manage", { at: "platform" })` and the destructive gate where today's
equivalents have it. They are transport, not `*Api` operations: nothing outside ops calls them. **No new
`*Api` operation is proposed.** The three `registeredMigrations()` operations retire with S6 (plan 6.2).

**Facts.** None new from modules. Alerts come from ops' own scheduled process manager over the reader.
The usage report's ops-health section gains an `upgrade` object (Q-U6); a sender at any version must
still land (`usage-report.ts:610`), so the field is optional and additive.

**`packages/upgrade` must expose** (S2 and S5 hold most of it; names illustrative):

- The ledger schemas it has (`upgradeStepSchema`, `upgradeRunSchema`), plus `target` if Q-U1 says yes.
- `UpgradeReader`: `status()` (installation state of section 4, installed, image, floor, origin,
  lease, last run), `listReleases()`, `listSteps({ release?, mode?, status? })`, `getStep({ id })`
  (with targets and the tenant summary), `listRuns({ cursor })`, `getRun({ id })`,
  `listTenants({ step?, state?, cursor })` (through each step's state port, plan 6.8),
  `preview({ manifests })`, `preflight()` returning checkup-shaped verdicts. The CLI prints these.
- `UpgradeRequests`: record a request to run a background or operator step, or a tenant action, which
  the worker's process manager executes under the lease and per-tenant leases (serving processes never
  run steps, plan 6.7). The api writes only the request.
- The manifest and floor types; `assertCurrent({ release })` for the serving refusal (S3), plus the
  floor check of Q-U5.
- How ops is handed the reader is a design question (Q-U8).

**Wire.** Ops' `listSystemMigrations`, `listMigrationEnrollments`, `searchMigrationOrganizations`,
`enrollMigrationTenant`, `enrollMigrationCohort`, `withdrawMigrationTenant`,
`runSystemMigrationForOrganization`, `runSystemMigrationPass`, `assertSystemMigrationLegacyWritersDrained`
and `rollBackSystemMigrationTenant` exist on main. The merge retires them for `ops.upgrade.*`; that is
a wire difference against main on an operator-only namespace and needs Alex's yes (Q-U9). Checkup ids,
`/api/checkup` and the usage report stay wire-compatible.

## 9. Scenarios to write first

In `modules/ops/specs/upgrades.feature` (new) unless noted; each slice writes its own before code.

- @integration The overview names the installed release, the image release and the floor
- @integration An image newer than the ledger reads as behind and names the command
- @unit A release below the floor reads as unsupported and names the LTS to upgrade to first
- @integration A run's phases are listed per release in the order they ran
- @integration A failed step names its error and its fix and is listed under needs attention
- @integration A tenant held past the threshold is failed, named and alerted, and blocks nothing
- @unit A view-only operator reads every upgrade screen and is refused every action
- @unit A destructive tenant action under impersonation is refused
- @integration Re-running a data step records a request the worker runs, never the api
- @unit The preview without the target's manifests prints the command that previews from the image
- @integration The checkup's migration rows agree with upgrade status (`specs/self-hosting/checkup/checkup.feature`)
- @integration A redeployed earlier release at or above the floor reads as rolled back
- @integration The fleet lists a self-hosted install's release and held count from its report (`modules/ops/specs/cloud-ops.feature`)
- Retire or rewrite `modules/ops/specs/ops-system-migrations.feature` scenarios as they move.

## 10. Slices

UI slices follow the plan's S slices; none lands before S2 (Q8: nothing early).

- **U1 Reader** (after S2). `UpgradeReader.status`, `listReleases`, `listSteps`, `listRuns`, `getRun`;
  `pnpm task upgrade status` printing them. Integration test against the local Postgres.
- **U2 Overview, release, run** (W1, W2, W4, read-only W3) in ops; nav entry; scenarios above.
- **U3 Checkup and doctor** (W10): rows read the ledger; `npx @langwatch/server doctor` gains status.
- **U4 Tenant steps merged** (after S5, S6): W3 tenant section, W6; enrolment and actions move from
  `/ops/migrations`; the old procedures retire (Q-U9); redirect; `docs/self-hosting/upgrade.mdx`
  "Check the migration results" rewritten.
- **U5 Background and operator steps** (after S7, S8): requests, worker execution, W3 data and procedure
  sections, CLI `run`.
- **U6 Preview and preflight** (after Q-U3): W5, `upgrade plan --to`.
- **U7 Alerts** (Q-U7): process manager checks, email, Slack, metrics, W9 banner.
- **U8 Fleet** (Q-U6): report's upgrade section, W8, redirect.
- **U9 Dataplanes** (Q-U1): ledger targets, W7, per-target run phases.

## 11. Questions for Alex

- **Q-U1 ClickHouse schema per dataplane.** Each private ClickHouse has its own goose record, and one
  unreachable endpoint fails the whole migrate today. (a) The ledger keys schema steps by
  (step, target) and the run fails as a whole when a target fails (today's behaviour, now visible);
  (b) as (a) but a failed private target fails only its organizations, which keep serving on the old
  schema until it catches up (needs the window rule per dataplane and a per-org refusal); (c) one row,
  targets in the report only. Recommendation: (a) now, (b) only if a private dataplane outage blocking
  every deploy proves real.
- **Q-U2 The name.** "Upgrade" means a plan upgrade everywhere else in the product. Options: "Upgrades"
  (operator-only page, collision limited to search and docs), "Updates", "Releases", "Version
  upgrades". Recommendation: page "Upgrades" under Ops, copy says "release upgrade" where both could be
  meant, CLI stays `upgrade`.
- **Q-U3 Where the latest release and its manifests come from.** (a) The install fetches the published
  release index and manifests (GitHub release assets or the docs site): egress, which the checkup
  already classes; (b) cloud's usage-report receiver answers with the latest release and the floor;
  (c) none: the preview runs only from the target image's CLI. Recommendation: (b) for "latest
  available" (the report is already sent where allowed) plus (c) for the preview; (a) if offline
  installs must preview in the UI.
- **Q-U4 Holding page while compose or npx upgrades.** With no old pods, the browser shows nothing
  until the run ends. Should the early liveness door (ruled: every process opens it before boot) serve
  a static "LangWatch is upgrading" page with phase and outstanding step ids, unauthenticated?
  Recommendation: yes, with no tenant or error detail on it.
- **Q-U5 Rollback rules.** (1) From S3 on, a serving process refuses when its release is below the
  ledger's floor. (2) After a rollback and re-upgrade, level-triggered background steps run again.
  Both are additions to plan 6.7 and 6.12. Recommendation: yes to both.
- **Q-U6 Cloud regions in the fleet.** Should LangWatch's own regions send the same usage report to
  cloud ops, so one fleet page covers cloud and self-hosted? Or does each region stay on its own
  page? Recommendation: report; it is one concept.
- **Q-U7 Alert channels on self-hosted.** Email platform operators (existing notification edge) plus
  the operator banner? Recommendation: yes; Slack only where ops' notifier is configured.
- **Q-U8 How ops gets the reader.** The ledger is store-derived (record §3.3 rule 1), but the step
  list comes from the installed modules' `.withMigrations` declarations, which only the process knows.
  (a) ops' registry builds the reader over its stores and the framework hands the collected step list
  as a resource; (b) a framework-owned read surface the container gives ops, as the eventing member
  gives replay; (c) the ledger alone, with step metadata copied into it at run time. This is a
  framework shape and belongs to S6's design.
- **Q-U9 Retiring ops' system-migration procedures.** Ten procedures on main's wire become
  `ops.upgrade.*`. Accept the operator-only wire difference, or keep the old names as aliases for a
  release?
- **Q-U10 Organization-facing surface.** Should an organization admin ever see that their organization
  is held or archived? Recommendation: no; the legacy path keeps serving, and a refusal after archive
  stays opaque (record §3.5).
- **Q-U11 Release notes in the preview.** Do steps carry a one-line human description (shown in W2,
  W5 and the CLI), declared with the step and stamped into the manifest? Recommendation: yes,
  required for blocking, background and operator steps; SQL steps take the migration's first comment.

## 12. Risks

- The old release's page reads ledger rows a newer runner wrote: ledger columns must stay additive
  and readers must tolerate unknown statuses and kinds (show them raw).
- Before S1 to S4 ship, an installation upgrading from a pre-ledger release has no run to show; the
  seed's `inferred` rows say so (plan 6.4).
- Polling the ledger from every open operator tab during a long run adds Postgres reads; the reader
  must answer from the two small ledger tables only, never per-tenant state, on the poll path.
- The preview is only as good as the manifests and estimates; a step without a declared estimate
  shows "unknown duration", never a guess.
- Moving enrolment onto the step drawer removes a page cloud operators know; the redirect and the
  docs change must land together.
- Q-U1 (b) or Q-U4 are the expensive answers; both widen the plan beyond its ruled slices.
