# Upgrade soak rounds: main, heavily seeded, upgraded to this branch (2026-10-10)

The plan to prove PR #7536's upgrade on real-shaped data. Each round: a blank slate, origin/main
installed and heavily seeded, then this branch booted on main's stores and watched until it settles.
Several rounds, each on the same frozen data, until three in a row pass.

Builds on, and does not restate: `.claude/tmp/handoffs/plan-upgrade-snapshots.md` (format, cells,
invariants I0-I11, drills K1-K6, rulings D1-D12), `dev/docs/runbooks/upgrade-and-flow-testing.md`
(how to run a cell today), `dev/docs/plans/seed-2026-10-09.md` (seedgen),
`dev/docs/plans/upgrade-and-flow-testing-drive-2026-10-09.md` (drive state). Results go to #8553.

## 1. One round

```text
 ONCE PER DATA SHAPE (slow, ~1-2 h)                 EVERY ROUND (fast, ~20-40 min)
 ┌───────────────────────────────────────┐          ┌──────────────────────────────────────────────┐
 │ blank stores                          │          │ restore snapshot ──► main api+worker up       │
 │   └► origin/main start:prepare:db     │          │   └► baseline: fingerprint + read-back (A)    │
 │   └► main api + worker up             │ snapshot │ traffic on (ingest, API, UI reads)            │
 │   └► HEAVY SEED through main's doors  ├─────────►│ CUT: old worker paused, jobs queue            │
 │       tenancy SQL · product kinds ·   │ (frozen) │ SWITCH: branch api, then branch worker        │
 │       telemetry backfill · workerrun  │          │   (cloud/hybrid rolling; self-hosted stop-   │
 │   └► jobs queued, capture + scrub     │          │    start) ── worker runs the upgrade          │
 └───────────────────────────────────────┘          │ WATCH: logs · uptime · Updates panel · RAM    │
                                                     │ SETTLE ──► JUDGE (§4) ──► report + #8553 row  │
                                                     └───────────────┬──────────────────────────────┘
                                                                     ▼
                                       findings by id ──► checkpoint list ──► fix lanes ──► same snapshot again
```

Why a snapshot and not a fresh seed each round: rounds stay comparable (same data, same ids, so a
failure is tracked by id, not count), and a round costs minutes, not the seed's hour.

## 2. What exists and what is missing

| Piece | State | Gap this plan closes |
| --- | --- | --- |
| `upgradelab cell` (main → branch, balancer, traffic, poller, shots, invariants) | ✅ cloud S runs end to end | origin is always a live S seed (W1) |
| `upgradelab snapshot capture/restore/fingerprint/verify` | ✅ verbs | the cell does not use them (W1) |
| Seed through main's doors | 🟡 upgradelab `seed/product.go` (each kind once), seedgen door executor (OTLP only) | heavy: many orgs, every kind in every state (W2) |
| Hybrid cell | 🟡 runs; red on N3, N4, I2, I9, O1 (runs 20-22) | fix list R0 |
| Self-hosted cell | ❌ run23 never reached ready (host load ~300: void) and wants a 3.20.1 tag | profile from origin/main, plus the real install paths (W4) |
| Monitoring | 🟡 logs grepped (I9), phases, shots | api origin printed, browser console, resource samples, timeline (W3) |
| Data integrity | 🟡 I4 counts, I6 one read per kind | old copy vs upgraded copy diff, read models (I5), every event parses (I7) (W3) |
| Updates panel and self-hosted UX | 🟡 two screenshots per run | a walk per phase, judged (W4) |

## 3. Workstreams to build the rig (before round 1)

Planning, review and orchestration run at high effort; execution lanes run Opus at medium effort or Sonnet. At most three lanes at once. Every lane writes its
scenario first (`specs/upgrade/…`), owns only its paths, and runs scoped tests only.

| # | Workstream | Owned | Done when | Model |
| --- | --- | --- | --- | --- |
| W1 | **Snapshot origin.** `upgradelab produce -deployment X -tier T` = stores, main up, seed (W2), jobs queued, capture. `upgradelab cell -from-snapshot DIR` restores instead of seeding. Local cache by (main sha, shape, tier, recipe) | `tools/upgradelab/cell/**`, `cmd/upgradelab`, `specs/upgrade/upgrade-snapshots.feature` | a cloud S snapshot produced once, two cells from it give equal "before" fingerprints | lane-opus, medium |
| W2 | **Heavy main seed.** seedgen's door executor gains product kinds (port `product.go` as door actions) and REST kinds; tenancy at volume by main-schema SQL; tier M = seedgen `medium` (12 orgs, 300k spans, every kind in every state, rare-state cohort); runs against a URL, not a haven slug | `tools/seedgen/door*.go`, `tools/upgradelab/seed/**` | `upgradelab produce -tier M` finishes on a laptop under the memory guard; `coverage.json` lists every kind main holds as seeded or says why not | lane-sonnet, medium |
| W3 | **Watch and judge.** Cell prints its api origin; Playwright captures console and failed requests per phase; samples RSS/CPU of each process and ClickHouse memory every 5 s; `report.md` gets a timeline ribbon. Integrity: I5 read-model checks, I7 stored-event parse (D4 (b), worker integration test), and A/B: restore the snapshot twice, main on copy A, branch on copy B, `apidiff probe -method GET` | `tools/upgradelab/cell/{checks,report,ops-upgrades.mjs}`, `apps/worker/src/__tests__/stored-events-parse.integration.test.ts` | a cloud S round reports all of it; a planted unknown event type is named by type and count | lane-sonnet, medium |
| W4 | **Self-hosted.** Profile `self-hosted` from origin/main (no tag; 3.20.1 stays its own cell). Real install paths: docker compose and helm on kind, with branch images built locally. A UX walk per phase: holding page, first-install token console (fresh install only), Ops > Upgrades in each state, sign-in, a trace list, settings. Screenshots judged by Haiku agents here, never in CI | `tools/upgradelab/cell/profile.go`, `tools/upgradelab/selfhosted/**` | compose and helm rounds each produce a report and a screenshot set per phase | lane-opus, medium |

W1 and W3 start together; W2 after W1's `produce` shape is fixed; W4 after W1.

### R0: fixes from runs 20-23 (in parallel with W1-W3)

Each is a #8553 finding; list broken, fix and how before any lane starts.

Triaged 2026-10-10 (`.claude/tmp/handoffs/soak-r0-triage.md`):

| Id | Verdict | Action |
| --- | --- | --- |
| I2 data steps | fixed in 2789015bc0 (`-- @tenancy:` sweeps) | prove in round 1 |
| I2 tenant steps | likely fixed in 8723c15870 (system-migrations pass after upgrade) | prove in round 1 |
| N4 | harness bug: the queue sampler stopped with the traffic, so a drain was never seen | W1: sample until settle ends; settle waits for depth 0 |
| N3 | follows N4 plus host load (only queued kinds lost) | covered by the N4 fix; rerun quiet |
| D1 | fixed in c5edd409c5 (tRPC sets Retry-After) | repeat the api-before-worker drill |
| H3 | unproven, probably transient | rerun quiet; if it repeats, schema-behind permission read → 503 `upgrade_in_progress` |
| I9 `system.backup_log` | real: the ops storage-footprint query errors where the table is absent | fix: check `system.tables` first |
| I9 cloudflared, `UpgradeInProgressError` | expected in the lab / during the no-holds window | W3: accepted signatures with reasons |
| I6 | seed bug: suite created without a scenario (422) | fix in `seed/product.go` |
| O1, run23 | host load (void) | rerun quiet |

## 4. What every round watches and judges

| Area | Watched live | Judged after settle | Pass |
| --- | --- | --- | --- |
| **Uptime** | balancer status per call; api phase poller | N1, N2, N5, N6, N7 | no unanswered call; ingest never non-2xx; reads retry `upgrade_in_progress` per Retry-After and succeed |
| **Logs** | `head-api.log`, `head-worker.log`, `tasks` | I9 against an accepted-signature list | no new signature; each accepted one has a reason |
| **Data integrity** | none | I4 copy-never-move, I5 read models, I6 read-back, I7 events parse, N3 no lost write, A/B GET diff | no table shrank, no lost write, every seeded id reads back, A/B diff names no new cause |
| **Upgrade itself** | Ops > Upgrades states; `upgrade status --json` | I0, I2, I2b, I3, I8, H1-H5 | every step done or not-needed on every target; second run is a no-op; hybrid data stays on its target |
| **Queues** | backlog sample | N4 | jobs queued at the cut drain on the branch worker |
| **Updates panel** | a screenshot per phase | O1 + Haiku judgement against `page-look` rules | Behind → Upgrading → Finishing in background → Up to date; no error flash while pending; text an operator understands |
| **Self-hosted UX** | the W4 walk | Haiku judgement, then Alex skims the set | holding page branded and centred; every message names what to do next |
| **Resources** | RSS, CPU, ClickHouse memory every 5 s | I10 at M and L | under bounds (set from round 2's numbers) |

A round run with host load over 40 is void, never red.

## 5. The rounds

| Round | Cells | Tier | Where | Goal |
| --- | --- | --- | --- | --- |
| 1 | cloud | S | laptop | rig works end to end from a snapshot; R0 fixes proven |
| 2 | cloud, hybrid, self-hosted (one at a time) | M | laptop, quiet | the heavy-seed shapes; first bounds |
| 3 | round 2's cells + drills K1, K2, K4, K5, K6 | M | laptop | recovery: kills, held locks, lease loss, double runner |
| 4 | cloud, hybrid | L | CI runner (D12) | scale: step durations and memory at plan 10-08 numbers |
| 5 | self-hosted via compose and helm images | M | laptop or CI | the path operators really take; full UX walk |
| 6 | replicated ClickHouse (D11) | S | CI | cloud's engine shape |
| 7 | cloud staging rehearsal (needs ruling Q1) | real | staging | the deploy itself, on cloud's own infrastructure |

Between rounds: findings by id, checkpoint list, fix lanes, then the same snapshot again. A fix
never holds a round; the next round picks it up.

**Exit:** each cell in rounds 2, 3 and 5 green three rounds in a row on one snapshot, round 4 green
once, then the public upgrade guide and register (plan-upgrade-snapshots §7).


## 6. Rulings (Alex, 2026-10-10)

- **Built code only.** No round runs a dev server, `tsx`, vite dev or watch mode, on either side.
  Main: `pnpm build` in its worktree, then `platform/app` `runtime:app` and `runtime:workers`
  (`dist/server/*.cjs`). Branch: `pnpm build`, then the image's commands (`apps/api` and
  `apps/worker` `start` with `NODE_ENV=production`, built UI bundle served). Rounds 4, 5 and 7 run
  real images. W1 replaces the cell's `runtime:app:dev` and `runtime:workers:dev`
  (`tools/upgradelab/cell/run.go:271`).
- Q1 yes: round 7 rehearses the cloud deploy on staging against a copy of cloud's data that never
  leaves cloud.
- Q2 seedgen `medium` on the laptop (rounds 1-3, 5); `large` and L on a CI runner (round 4).
- Q3 compose and helm in round 5; the npx server later.
- Q4 exit bar: each cell green three rounds in a row on one snapshot.
- Effort: planning, review and orchestration at high effort; execution lanes Opus at medium effort or Sonnet.

## 7. The data: one snapshot per shape

Every snapshot is written by **main itself** (built), through main's own doors: tenancy SQL at
main's schema for what main has no door for, product kinds through main's tRPC and REST, telemetry
through OTLP and the collector, model calls answered by llmsim. Names are invented. Every id comes
from (seed, kind, n), so two productions with one seed hold the same logical data.

### 7.1 Shapes

| Snapshot | Env | Orgs (persona) | Projects / users | Telemetry (30 days + a 90-day-old slice) | Extra |
| --- | --- | --- | --- | --- | --- |
| `cloud.S` | `saas.env` | 3 typical | 12 / 40 | 2k traces, 10k spans | today's cell seed; round 1 only |
| `cloud.M` | `saas.env` | 12: 3 startup, 3 enterprise-sso, 3 gateway-heavy, 3 agent-eval | 48 / 400 | 60k traces, 300k spans, 300k logs, 600k metric points | subscriptions via paymentsim (free, team, enterprise, `past_due`, cancelled, trial) |
| `hybrid.M` | `hybrid.env` | `cloud.M` + 2 private (reduced enterprise-sso, reduced agent-eval) | 56 / 460 | as `cloud.M`; private orgs' on their own ClickHouse and S3 | each private org has a ClickHouse database and bucket of its own |
| `sh-licensed.M` | `sh-licensed.env` | 3: enterprise-sso, agent-eval, startup | 16 / 120 | 20k traces, 100k spans | test licence, `ADMIN_EMAILS`, SSO and SCIM via idpsim; no subscriptions |
| `sh-free.M` | `sh-free.env` | 1: startup with agent-eval content | 4 / 8 | 10k traces, 50k spans | no licence; variants `ADMIN_EMAILS` set and unset |
| `empty` | each env | none | none | none | fresh install |
| `cloud.L`, `hybrid.L` | as above | plan 10-08: tenancy by SQL | 20k / 200k | 500k traces, 5M spans, ~25M events, 2k datasets | CI runner only |

### 7.2 What every M snapshot holds (in every state main can hold)

| Area | Content |
| --- | --- |
| Identity | users active, deactivated, unconfirmed, never signed in, erased; pending and accepted invites; join requests; two orgs sharing a user |
| Access | members on every built-in role; custom roles (enterprise); API keys legacy project, ownerless, personal, revoked, expired; SSO connections OIDC and SAML (enterprise); SCIM-provisioned users and groups |
| Projects | team, personal, archived, revived; privacy and retention policies varied; PII redaction on |
| Telemetry | RAG, tool and LLM spans; threads sharing a conversation id; multimodal; a wide trace (5,000 spans); a spooled large span; a dead-lettered span (labelled fault); logs and metrics |
| Evaluation | evaluators of every kind; monitors ON_MESSAGE and AS_GUARDRAIL; monitor results; Instant Eval runs; judge spend |
| Experiments | batch evaluations and workbench runs, one aborted, one failed cell; datasets with rows in Postgres (feeds `dataset:move-content-to-object-storage`) |
| Agents | workflows with versions and HTTP credentials (feeds `workflow:move-http-credentials-to-secrets`), agents, scenarios and suites with runs succeeded, failed, cancelled and **open** at the cut |
| Prompts | prompts with versions, some tagged `production`, some untagged orgs (feeds `prompt:seed-tags-for-untagged-organizations`) |
| Automation | triggers, reports with schedules, Slack connections with active and paused triggers, alerts to outboundsim |
| Gateway | virtual keys in every state, budgets per scope and window (BLOCK and WARN), a breach, governance sources, anomaly rules with inline webhooks, coding-assistant usage |
| Model providers | custom keys stored in plain text, as main stores them (feeds `model-provider:seal-plaintext-custom-keys`) |
| Annotations | every score type, queues with open items |
| Topics | clustering schedules and topic history |
| Queues at the cut | the old worker paused for 60 s under traffic, so every lane holds jobs |

`tools/upgradelab/seed/coverage.json` must end with every declared step `seeded` or `unheld` with a
reason; 22 of 37 are `pending` today (W2's acceptance).

### 7.3 Overlays (round 3, applied after restore)

| Overlay | Plants | Expect |
| --- | --- | --- |
| `held-tenants` | one tenant whose system-migration proof disagrees | stays held, named in Ops > Upgrades; others finish |
| `operator-damage` | a failed `_prisma_migrations` row; a hand-built index of a migration's name; a private target one goose version behind | named failure with the fix (`prisma migrate resolve`); `IF NOT EXISTS` finds the index; the target catches up |
| `upcast-events` | branch-era event types | upcast on read, zero parse refusals (I7) |

## 8. The runs

Every run: quiet host (load ≤ 40), built code, restore the snapshot, boot main, baseline A, traffic
on, cut, switch, settle, judge, report, a #8553 row `UP-<round>-<cell>`. Rerun the same run until it
is green three times.

### 8.1 Traffic during every run (from 30 s before the cut until 2 min after ready)

| Stream | Rate (S / M) | Shapes |
| --- | --- | --- |
| OTLP traces, logs, metrics; collector | 1/s / 20/s | all |
| REST and tRPC reads (traces, datasets, prompts, analytics) | 2 s / 5/s | all |
| Writes: prompt create and update, dataset create and rows, annotations | 4 s / 1/s | all |
| Scenario and batch-evaluation runs started (workerrun) | none / 1 every 10 s | all M |
| Gateway calls through aigateway to llmsim, one key over budget | none / 5/s | cloud, hybrid |
| Private-org ingest and reads | 1/s / 5/s | hybrid |
| Browser: a signed-in user walks traces, a trace drawer, prompts, experiments, Ops > Upgrades every 10 s (Playwright, console and failed requests recorded) | on / on | all |
| SSO sign-in through idpsim; a SCIM push (create, deactivate, group move) mid-upgrade | none / every 30 s | sh-licensed, enterprise orgs |

### 8.2 Run sheet

| Run | Snapshot | Switch | Scenarios (each must pass) |
| --- | --- | --- | --- |
| **R1-cloud** | `cloud.S` | rolling: branch api beside main, branch worker 10 s later | S1-S12 |
| **R2-cloud** | `cloud.M` | rolling | S1-S14 |
| **R2-hybrid** | `hybrid.M` | rolling | S1-S14, H1-H5 |
| **R2-shlic** | `sh-licensed.M` | stop-start | S1-S14, E1-E4 |
| **R2-shfree** | `sh-free.M` (both `ADMIN_EMAILS` variants) | stop-start | S1-S14, E5 |
| **R2-empty** | `empty` per env | none: fresh branch install | F1-F3 |
| **R3-\<cell\>** | R2's snapshot + overlays | as R2 | R2's set + K1, K2, K4, K5, K6 and the overlay rows of §7.3 |
| **R4-cloud / R4-hybrid** | `cloud.L`, `hybrid.L` | rolling, images | S1-S14 (+H) and I10 bounds |
| **R5-compose / R5-helm** | `sh-licensed.M` and `sh-free.M` restored into the compose and kind stores | the operator's own steps from `docs/self-hosting/upgrade.mdx`, followed literally | S1-S14, E1-E5, U1-U6 |
| **R6-replicated** | `cloud.S` on `CLICKHOUSE_CLUSTER` (one keeper) | rolling | S1-S12 |
| **R7-staging** | cloud's data, in cloud | the real deploy | S1-S11 from cloud's own dashboards and logs |

### 8.3 Scenarios

Each becomes a scenario in `specs/upgrade/upgrade-soak-rounds.feature` (W3 writes it first), bound to
the cell check that judges it.

| Id | Scenario | Judged by |
| --- | --- | --- |
| S1 | The api answers every call from its first second; no call goes unanswered | N1, N6 |
| S2 | Ingest never answers a non-2xx, on any attempt | N5 |
| S3 | A read that meets a schema still behind gets 503 `upgrade_in_progress` with Retry-After and succeeds on retry | N2, D1 |
| S4 | Every 2xx write is visible after settle | N3 |
| S5 | Jobs queued at the cut drain on the branch worker; no unexpected dead letter | N4 + fault-cohort labels |
| S6 | The branch worker runs the upgrade; the api runs no step | I0 + log read |
| S7 | Every step ends done or not-needed on every target; nothing reopened | I2, I2b |
| S8 | No table loses rows; every pre-existing event is still there | I4 |
| S9 | Every seeded id reads back through the branch; old copy and upgraded copy answer every GET the same, bar accepted causes | I6, A/B apidiff |
| S10 | Read models are filled: trace meter per org per month, SCIM view, open suite runs, privacy and retention resolve | I5 |
| S11 | No new error signature in api, worker or task logs; no browser console error | I9 + console capture |
| S12 | Ops > Upgrades walks Behind, Upgrading, Finishing in background, Up to date, with no error flash | O1 + Haiku |
| S13 | A second upgrade changes nothing | I8 |
| S14 | Every stored event parses under the branch's schemas and upcasts | I7 |
| H1-H5 | Hybrid: data lands only on its own target and bucket; every target migrated; a private org reads its own data; a shared org cannot | cell H1-H5 |
| E1 | The licence carries over; enterprise features stay on | `licensing:copy-organization-licenses` + a read |
| E2 | SSO sign-in works before, during and after the switch | traffic SSO stream |
| E3 | SCIM pushed mid-upgrade lands once | SCIM stream + user count |
| E4 | Custom roles and grants behave as on main: a key with no grant is refused, never answered | grants flow on the upgraded stores |
| E5 | `ADMIN_EMAILS` set: that user is operator after the upgrade; unset: the documented bootstrap works | operator read |
| F1 | Fresh install: every data step is not-needed; the api serves | I2 |
| F2 | A second run is a no-op | I8 |
| F3 | The first-install token console shows only when the first install fails | forced failure + screenshot |
| U1 | The holding and upgrading pages are branded, centred and say what is happening | screenshots + Haiku |
| U2 | The upgrade guide's commands work exactly as written | the R5 operator transcript |
| U3 | Ops > Upgrades explains a held tenant and a failed step, and Retry fixes the failed one | overlay rows + D3 |
| U4 | An operator can tell from the panel alone when it is safe to stop the old release | Haiku + Alex skim |
| U5 | compose `up` with the new image needs no step the docs omit | R5 transcript |
| U6 | helm `upgrade` rolls with no unanswered call | S1 on the kind stack |
