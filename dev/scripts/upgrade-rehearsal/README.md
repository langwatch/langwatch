# Upgrade rehearsal

Section F of `dev/docs/plans/pr-7536-migration-plan-2026-10-08.md`, phases 0 to 2: the real
upgrade from an old image to head, over one set of stores, with the old and new processes
overlapping. It reproduces R01, R02, F-1 and F-2 and settles Q09, and writes a report.

## Run it

Needs a Docker daemon with the compose plugin, Node and curl, and about 8 GB of memory. The
script refuses with exit 3 and names what is missing when the host cannot run compose.

```bash
# From the 3.20.1 floor to this working tree (builds head; pulls langwatch/langwatch:3.20.1)
bash dev/scripts/upgrade-rehearsal/rehearse.sh --origin 3.20.1 --build-head

# From origin/main (built with git archive, no checkout) in both stop orders
bash dev/scripts/upgrade-rehearsal/rehearse.sh --origin main --build-main --build-head --order api-first
bash dev/scripts/upgrade-rehearsal/rehearse.sh --origin main --build-main --build-head --order worker-first

# A fresh install
bash dev/scripts/upgrade-rehearsal/rehearse.sh --origin empty --build-head
```

Reuse built images with `--old-image` and `--head-image`. `--keep` leaves the stack up for
inspection. The run directory defaults to `.claude/tmp/upgrade-rehearsal/<origin>-<order>-<id>/`
and holds `report.md`, `report.json` and every piece of evidence under `evidence/`.

## What each phase does

- **Phase 0.** Stores up; the old api and worker up; organisations, teams, users (active,
  deactivated, never signed in) and projects (team, archived, personal, second organisation)
  written at the old schema by `seed/tenancy.sql`, because the old image has no headless surface
  for them; traces in this month and the last sent through the old api's OTLP door. The old
  worker is then paused and more traces sent, so jobs sit queued at the cut.
- **Phase 1.** A load generator writes through the old api; head's `start:prepare:db` runs while
  it serves; the old api restarts over head's schema (its start re-runs the old upgrade); head's
  api and worker start; the head worker takes SIGTERM while a background step runs (F-2); the
  old api and worker stop in the order `--order` names.
- **Phase 2.** Waits up to `--settle-seconds` for background steps, then collects the ledger,
  the roster, the scope tables, the queues, the head worker's metrics and every log, and runs
  `evaluate.mjs`.

## Findings

| Finding | Reproduced when                                                                   |
| ------- | --------------------------------------------------------------------------------- |
| R01     | a seeded project does not resolve a privacy policy (`resolution.json`)            |
| R02     | the head worker logs `ProjectNotFoundError`                                       |
| F-1     | a head roster row declares no steps and a needs-old-writers-gone step is not done |
| F-2     | a step running at SIGTERM is recorded done before the worker exits                |
| Q09     | jobs queued at the cut are left, dead-lettered, refused or unroutable on head     |

A finding whose evidence was not collected is `inconclusive`, never a pass. Q09 reads `settled`
when head drained every job the old image left.

## Phases 3 to 7

`--through N` stops after phase N (default 5); `--scale` adds phase 6; `--bounds FILE` (JSON
`{"stepSeconds": N, "workerMemoryMiB": N}`) lets phase 6 judge. An empty origin runs phase 5's
second-run check only. Every run routes the second organisation to `clickhouse-private`.

- **Phase 3, rollback.** From 3.20.1, head writes a `DEVELOPER` membership and joiner role (P31);
  head stops; `upgrade pre-roster-rollback` is recorded; the old api and worker start on head's
  schema and the MIG-COMPAT HTTP smoke writes through them. Schema-read errors naming P16's or
  P31's values are documented; any other is a failure (`ROLLBACK`).
- **Phase 4, re-upgrade.** Head's upgrade runs again, head rolls out, `upgrade old-writers-gone`
  runs, the ledger settles; steps that re-ran are listed for a reviewer to judge by kind
  (`REUPGRADE`).
- **Phase 5, drills.** The re-upgrade's run loses its runner lease (`LEASE`); a head worker is
  killed mid-step (`SIGKILL`; SIGTERM is phase 1's F-2); ClickHouse pauses for 20 s; a second
  upgrade run must change no step (`NO-OP`).
- **Phase 6, scale.** `seed/scale.sql` writes the tenant set; memory is sampled throughout (`SCALE`).
- **Product seeds.** Phase 0 seeds through the old tRPC; phase 2 reads back through head (`SEED-*`).
- **Phase 7.** Phase 0 exports `event_log` to `event-log.jsonl` (`EVENTS`).
- **Private target.** Goose versions of both ClickHouse targets and their ledger rows (`TARGETS`).

## Not covered yet

Each gap reads `inconclusive`, never passed:

- **Phase 0 product seeds, partly**: `seed/product.mjs` signs in to the old image as an account
  seeded by `migration-compat-smoke/seed-account.sh` and writes a privacy and a retention
  policy, an annotation, a workflow, a Slack connection, a report and a suite through its tRPC;
  phase 2 reads each back through head's api (`SEED-<kind>`). A licence is seeded only with
  `REHEARSAL_LICENSE_KEY`; SSO and the coding assistant have no headless seed. A kind that was
  not seeded or not read back is `inconclusive`. The workflow DSL and the privacy config are
  unproven against a real image.
- **Phase 2's per-row checks** beyond R01, R02, F-1, Q09 (R03 to R10, P01, S06, S08, S09, O01,
  C02) wait for those seeds.
- **Phase 4**: duplicate detection and ops' redrive of blocked groups have no headless surface.
- **Phase 5**: two workers on one step and S08's tenant-cursor resume are proved by the
  `packages/upgrade` integration suites, not here; checkpoint resume is read from the report.
- **Phase 6**: spans at scale (5 million) need a ClickHouse bulk seeder; no bound is ruled yet.
- **Phase 7**: head has no command that parses stored events with its schemas and upcasts.
- Old-api restarts are recorded, not asserted. R02's dead-letter needs the 2.6 h retry window.
- Real images run only on a host with Docker and about 8 GB (CI: `upgrade-rehearsal.yml`, not
  yet written).

Unit checks: `TZ=UTC node --test dev/scripts/upgrade-rehearsal/__tests__/*.unit.test.mjs`.
