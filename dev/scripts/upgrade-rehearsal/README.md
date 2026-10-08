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
| R01     | a seeded project has no `DataPrivacyProjectScope` row                             |
| R02     | the head worker logs `ProjectNotFoundError`                                       |
| F-1     | a head roster row declares no steps and a needs-old-writers-gone step is not done |
| F-2     | a step running at SIGTERM is recorded done before the worker exits                |
| Q09     | jobs queued at the cut are left, dead-lettered, refused or unroutable on head     |

A finding whose evidence was not collected is `inconclusive`, never a pass. Q09 reads `settled`
when head drained every job the old image left.

## Not covered yet

Phases 3 to 7, and the phase 0 rows that need the old image's product surfaces (privacy and
retention policies, annotations, workflows, Slack, reports, licences, SSO, suites, coding
assistant, a private ClickHouse route). Old-api restarts are recorded, not asserted. R02's
dead-letter needs the 2.6 h retry window; a default run sees the throws only.

Unit checks: `TZ=UTC node --test dev/scripts/upgrade-rehearsal/__tests__/*.unit.test.mjs`.
