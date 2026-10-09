# Upgrade in the worker (design freeze, 2026-10-09)

Ruling UPGRADE-IN-WORKER (Alex, 2026-10-09, round 70): the worker runs every upgrade step under the
runner's lease; a new api boots in an upgrading mode serving sign-in and the Ops Upgrades page only
until the ledger is current (replacing the bare holding page); a blocking step never touches sign-in
tables. Supersedes UPGRADE-FIXES' "the worker never does" (record §7, "Migrations are not the api's
job"). Nothing here is applied; the record text is in section 7. Every open call in section 9 is
ruled (UIW-1..11, Alex, 2026-10-09, round 70: each took its recommendation).

## 1. Today (read from the tree)

```
Helm upgrade    pre-roll Job (new image) -- pnpm task upgrade --> ledger current --> Deployments roll
Helm 1st install api gate: first-install --> spawns `pnpm task upgrade` (child) behind holding page
compose         `migrate` one-shot service --> app + workers wait (service_completed_successfully)
npx server      services/migrate.ts runs `upgrade` --> then api + worker
self-hosted api gate: behind --> spawns the same child behind the holding page (admitAfterFirstInstall)
  failure       holding page becomes the token console (/_upgrade/console, /_upgrade/retry, D1-D6)
worker          gate: behind --> refuses by name, exits, orchestrator restarts it until current
                admitted --> background steps under per-step leases `background:<step id>`
```

Where: `packages/upgrade/src/gate/serving-upgrade-gate.ts` (`admitAfterFirstInstall`, role `api`
only), `gate/first-install-upgrade.ts` (the child), `packages/process/src/migration/upgrade-gate.ts`
(gate component, console token), `lifecycle/liveness-thread.ts` (holding page, console, probes),
`runner/runner-lease.ts` (lease `upgrade`, ttl 60 s, wait 10 min), `background/background-steps.service.ts`.
Probes: app startup `/api/health` 160 x 15 s, readiness `/readyz`; workers startup `/healthz` :2999.

## 2. Target

```
            new worker (any replica)                         new api (any replica)
boot -> gate.admit ---------------------------------+   boot -> gate.admit
  behind / first install                            |     postgres-schema steps outstanding
    lease `upgrade` free? --no--> wait, re-ask 10 s |       --> HOLDING: bare page, not ready
    yes --> child `pnpm task upgrade`               |     schema done, blocking/reconcile left
      preflight > pg schema > ch schema >           |       --> boot container, UPGRADING:
      blocking data > reconcile  (ledger rows)      |           sign-in + Ops Upgrades only,
    exit 0 --> re-ask --> current --> take jobs,    |           rest = holding page, not ready
               start background steps (unchanged)   |     ledger current (poll 10 s)
    failed --> step `failed`, wait for Retry  <-----+---- Retry (Upgrades page / console):
               (failed -> pending), then run again  |       failed step -> pending
                                                    |     --> SERVING: hold lifts, /readyz ready
```

## 3. What moves

| Concern | Today | Target |
| --- | --- | --- |
| Who takes the lease | api child, Helm Job, compose `migrate`, npx | the worker's child; CLI stays a runner for dev, CI, by hand |
| Who runs blocking steps | `pnpm task upgrade` in those | the same command, spawned by the worker gate |
| api on a behind ledger | spawns the upgrade | never runs a step; holding then upgrading mode |
| worker on a behind ledger | refuses and exits | runs the upgrade, or waits for the holder; takes no job until current |
| How the api learns "current" | its own child exits 0 | its gate re-reads the ledger every 10 s on its one connection |
| Background steps | worker, per-step leases | unchanged (Q8) |

The child keeps the record's split ("tasks runs the blocking ones, the worker the background ones,
the api builds none"): the worker hosts the tasks app's run, it does not compose blocking steps.
`admitAfterFirstInstall` moves from role `api` to role `worker`; the worker gets the wait loop the
`@unimplemented` scenario "The worker waits for the api's upgrade instead of exiting" describes, now
waiting for its own or a peer's run. Lease held by another runner: no spawn, re-ask (the child's
"lease held" exit is not a failure).

## 4. Upgrading mode

- **Phases from the ledger.** Holding while any `postgres-schema` step of the image is outstanding
  (sign-in code on a schema it was not built for fails: Q1). Upgrading while blocking `data` steps or
  reconcile remain. Serving when the gate's blocking set is done. ClickHouse schema does not gate
  sign-in: neither sign-in nor the Upgrades page reads ClickHouse.
- **What serves.** Routes declared to serve while upgrading (Q6): auth's sign-in REST (better-auth
  handler, session, SSO callback), ops' upgrade reads (`ops:view` at platform) and `retryStep`
  (`ops:manage`), `/api/health`, and the SPA's sign-in and `/ops/upgrades` navigations. Everything
  else answers what the liveness thread answers today: the holding page for HTML, 503 "LangWatch is
  upgrading" + `Retry-After: 10` otherwise. SDK ingestion therefore gets the same 503 as today.
- **How it is authorised.** Nothing new: the door still asks each route's declared permission;
  sign-in routes are public as now; the Upgrades procedures keep `ops:view` / `ops:manage` at
  platform. Upgrading mode only narrows which routes are reachable, in front of the door.
- **Stable tables.** Sign-in reads `User`, `Account`, `Passkey` (user), `Session`,
  `VerificationToken`, `SignInAttemptLock` (auth), `Organization`, `OrganizationUser`,
  `OrganizationInvite` (organization), authz's grant tables (the platform `ops:*` check) and the
  SSO config (`SsoConnection` and its tables, owned by identity). The set is "every table owned by
  auth, user, organization, authz and identity" (Q9), resolved from ownership claims, never a hand list.
- **Refusing a blocking step that touches them.** Blocking steps are frozen SQL, so the check is
  static: a `lint:architecture` policy (`upgrade-sign-in-tables`) reuses migration-owners' touch
  parsing (`packages/architecture-enforcer/src/policies/persistence/migration-owners.ts`) and
  refuses a `blocking` step whose SQL touches a table those owners claim, naming the step and table.
  Such a change ships as a `background` step (expand/contract) instead.
- **Browser.** The holding page gains "Sign in to follow the upgrade" (to sign-in, redirect
  `/ops/upgrades`). The shell must render sign-in and the Upgrades route when its other startup
  reads answer 503; any other route shows the upgrading frame (phase, "n of m", the `@unimplemented`
  progress scenario).

## 5. Per platform

- **Kubernetes.** Old api and worker pods keep serving on the expanded schema (the same guarantee
  the pre-roll Job relies on). The first new worker pod takes the lease; other new workers wait.
  New api pods pass the startup probe (`/api/health` serves in both modes) and report not ready
  until current, so the Service keeps routing to old pods (Q5). `helm upgrade --wait --timeout 45m`
  now waits on readiness instead of the Job. A failed run stalls the roll with old pods serving.
  First install: no old pods; the api holds through the schema phase and the empty-database blocking
  steps finish in moments; the worker no longer "refuses and restarts until done".
  Pre-roll Job: removed by default (Q4), rendered only with
  `app.storedObjects.localFilesystem.serializeUpgrades`, whose hooks hold workers at 0 until the app
  has rolled; there the Job runs the upgrade first under the same lease (Q11).
- **docker compose.** `migrate` service goes; app and workers depend on the stores only. The worker
  runs the upgrade; the app answers holding then upgrading mode at :5560, never a refused
  connection (`@unimplemented` "Compose and npx start the app without a separate migrate step").
- **npx server.** `services/migrate.ts`'s phase goes; the launcher hosts both halves in one Node
  process, so its worker half's gate spawns the child. `doctor` keeps `printUpgradeStatus`.
- **haven, pnpm dev, CI, rehearsal.** Keep `start:prepare:db` before the lanes: same runner, same
  lease; the worker then finds the ledger current. Fast and deterministic for tests.

## 6. Failure and retry

| Case | Worker | api | Way out |
| --- | --- | --- | --- |
| step fails in schema phase | step `failed`, waits | holding + token console (Q7) | console Retry or CLI |
| step fails in blocking phase | step `failed`, waits | upgrading; Upgrades page shows it | `retryStep` (`ops:manage`) |
| worker dies mid-step | lease lapses after 60 s | unchanged | next worker resumes from the checkpoint |
| two workers start | one runs, others wait | unchanged | - |
| CLI run holds the lease | waits | unchanged | - |
| image below floor | refuses by name (as today) | refuses by name | stop at the named LTS |
| ledger unreadable | refuses, restarts (as today) | refuses | fix `DATABASE_URL` |
| worker restarted after a failure | runs once again (a restart is an operator act, D2) | new console token | - |

Retry is one mechanism: a failed step goes back to `pending` in the ledger (`retryStep` widened from
background steps to every step the worker runs, Q10; the console's Retry writes the same through the
api's gate connection). The waiting worker sees no failed step while still behind and runs again.
The console's log tail comes from the run report in the ledger (`runner/run-log.ts`), since the api
no longer owns the child's output.

## 7. Record replacement text (proposed; lands with slice 2, not before)

Replaces the second and third sentences of "Migrations are not the api's job" (from "They run
through" to "never does (Alex, 2026-10-09, UPGRADE-FIXES)."); the rest of the paragraph stays.

> **Migrations are not the api's job.** The worker runs every upgrade step under the runner's lease:
> at boot, while the ledger is behind its image, its gate runs `pnpm task upgrade` (the tasks app's
> runner, in its own process), waits while another runner holds the lease, takes no job until the
> ledger is current, and after a failed run waits for a Retry that returns the step to `pending`
> (Alex, 2026-10-09, UPGRADE-IN-WORKER, superseding UPGRADE-FIXES' "the worker never does").
> `pnpm task upgrade` stays a runner under the same lease for development, CI and an operator
> (apps/api `start:prepare:db`: upgrade alone; no system-migrations pass); the Helm pre-roll Job
> renders only with `serializeUpgrades`, and the compose `migrate` service is gone. The api never runs a step: while a Postgres schema step of
> its image is outstanding it serves the holding page; after that, until the ledger is current, it
> serves in upgrading mode, only sign-in and the Ops Upgrades page (the routes declared to serve
> while upgrading through a `packages/api` route declaration the door enforces; everything else
> answers the holding page), and reports not ready. A blocking step never touches a table owned by
> auth, user, organization, authz or identity; `lint:architecture` refuses one that does
> (UIW-1..11).

## 8. Slices, in order

| # | Slice | Paths | Owner | Tests |
| --- | --- | --- | --- | --- |
| 0 | Specs first: rewrite `in-app-upgrade.feature` (worker runs, api phases, upgrading mode, retry), `entry-points.feature` (no Job, no `migrate`, npx), `serving-gate.feature` worker scenarios; add the sign-in-table scenario to `packages/architecture-enforcer/specs` | `specs/upgrade/`, enforcer specs | Sonnet high | `check:feature-parity` |
| 1 | Sign-in table policy | `packages/architecture-enforcer/src/policies/persistence/` | lint-rule lane, Sonnet high | fixture unit test; tree clean before it ships at error |
| 2 | Worker gate runs the upgrade: move `admitAfterFirstInstall` to `worker`, lease-held wait, wait-for-Retry loop, 10 s re-ask; api gate returns holding/upgrading/current and never spawns | `packages/upgrade/src/gate/`, `packages/process/src/migration/upgrade-gate.ts` | Opus high | unit (loop, verdicts); integration over a real ledger |
| 3 | Upgrading mode in the door: hold with pass-through for declared routes; readiness latched at current; `/api/health` serves | `packages/process/src/lifecycle/`, `packages/api` (declaration, Q6) | Opus high (authz surface) | `upgrade-holding-page.feature`; thread routing unit |
| 4 | Declare the routes: auth sign-in, ops upgrade reads + `retryStep`; widen `retryStep` (Q10) | `modules/auth`, `modules/ops` | Opus medium | `modules/ops/specs/upgrades.feature`; auth sign-in installation test in upgrading mode |
| 5 | Browser: holding-page sign-in link, shell renders sign-in + Upgrades under 503s | `packages/browser-host`, `modules/ops/browser` | Sonnet high | component tests; visualdiff flow |
| 6 | Console: read failure from the ledger run report, Retry writes `pending`, shown only in the holding phase | `packages/process/src/migration/`, `lifecycle/` | Opus high (security) | the 14 console scenarios rebound |
| 7 | Entry points: render the Helm Job only with `serializeUpgrades` (Q4, Q11), drop compose `migrate`, drop npx migrate phase, NOTES and `docs/self-hosting/upgrade.mdx` | `charts/langwatch`, `infra/compose.yml`, `apps/server` | Sonnet high | `entry-points.feature` unit scenarios; chart render tests; rehearsal run |
| 8 | Record (section 7 text) with slice 2's commit; `upgrade` skill shape and "Never" list; ADR-173 amendment | `dev/docs/`, `.claude/skills/upgrade` | coordinator | - |

Order: 0, then 1 and 2 in parallel, then 3 and 4, then 5 and 6, then 7 (never before 2: removing the
Job or `migrate` first leaves nothing upgrading), 8 lands with 2. Proof: `dev/scripts/upgrade-rehearsal`
from the LTS floor on compose and npx, plus `tools/upgradelab` once its harness lands.

## 9. Questions (ruled: UIW-1..11, Alex, 2026-10-09, round 70)

Each took its recommendation.

| # | Question | Ruled |
| --- | --- | --- |
| 1 | Sign-in during the schema phase | (a) holding page until the Postgres schema steps are done, then upgrading mode |
| 2 | How the worker runs it | (a) spawns `pnpm task upgrade` as a child process under the lease |
| 3 | After a failed run | (a) waits for Retry, plus one run per worker restart |
| 4 | Helm pre-roll Job | (a) removed, NOTES keeps the `kubectl run ... start:prepare:db` line (see 11) |
| 5 | Readiness while upgrading | (a) not ready until the ledger is current |
| 6 | Declaring what serves while upgrading | (a) a route-level declaration in `packages/api`, enforced by the door |
| 7 | Token console | (a) kept, only for failures in the holding phase |
| 8 | Background steps' lease | (a) per-step `background:<id>` leases stay |
| 9 | Sign-in table set | tables owned by auth, user, organization, authz and identity (owner of `SsoConnection`, the SSO config, per `modules/catalogue.json` and the Prisma claims), resolved from ownership claims |
| 10 | `retryStep` widened | yes: schema and blocking steps too, `ops:manage`, same `upgrade_step_not_failed` 409 |
| 11 | `serializeUpgrades` deadlock | (a) the pre-roll Job renders only when `serializeUpgrades` is on |

## 10. Noticed, not changed

- `charts/langwatch/templates/app/migrate-pre-roll-job.yaml` header said the Job runs "then the
  system-migrations pass"; fixed in slice 0.
- `specs/upgrade/entry-points.feature` (compose `migrate`) and `in-app-upgrade.feature` (`@unimplemented`
  "without a separate migrate step") disagreed; slice 0 settled both.
- A stack with no worker (chart `workers.enabled: false`) would never upgrade; CLAUDE.md says ui,
  api and worker always run together, so the chart should refuse that combination or run the worker
  half in the app pod. Confirm in slice 7.
