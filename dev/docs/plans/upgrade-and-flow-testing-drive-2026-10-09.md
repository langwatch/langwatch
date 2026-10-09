# Upgrade and flow-testing drive (2026-10-09)

The working plan for proving PR #7536 ships safely: graceful upgrades, a seed that produces every kind of data, and a tested-flow ledger. This page is what we keep so nothing is forgotten; update it as items land.

- Work ledger: #8493. Tested-flow ledger: #8553 (sub-issue of #8493).
- Runbook: [upgrade-and-flow-testing.md](../runbooks/upgrade-and-flow-testing.md). Seed design: [seed-2026-10-09.md](seed-2026-10-09.md).

## 1. Goal

```
seed (every kind, any size) ─► upgrade main → branch in every shape ─► run every flow ─► #8553 rows ✅ with evidence
        │                                │                                    │
   seedgen + runner              upgradelab cells                      runbook + sims
```

Shapes: self-hosted · cloud · cloud hybrid (tenants on their own ClickHouse and S3, shared Postgres), each × tenant counts × data sizes.

## 2. Rulings recorded today

| Topic | Ruling |
| --- | --- |
| API during upgrades | Api stays up; worker may be down; no holds. A read on a schema still behind answers 503 `upgrade_in_progress`, Retry-After 10 s; clients retry. ClickHouse reads are defensive (missing column → default), column list refreshed every 30 s |
| Token console | Only on a failed first install |
| Cloud upgrade cell | Old and new api overlap; an unanswered call is a failure |
| Authorization | Fails closed; caught by typecheck, runtime or lint. Lint refuses optional authorization checks, not optional settings |
| Migration guards | Postgres: one ALTER per table, no inline DML on existing tables, no volatile defaults, lock_timeout ≤ 2 s. ClickHouse: mutations need a `-- background step:` note; ORDER BY, OPTIMIZE FINAL, POPULATE always refused. Cutoff = newest `langwatch@v*` tag. `ops:copy-automation-migration-state` stays blocking. Main's instant-evals migration is exempt (byte-identical to main) |
| Event retention | Opt-out: only telemetry-like events expire. Expire: per-trace and per-evaluation facts (first-trace and evaluation-ran kept), Instant Eval runs, provider usage readings, spend webhook deliveries, ingestion-pull run results and listings. Keep forever: judge spend, annotations, budget crossings, read audits, ingestion-pull configuration. Tenant policy reaches event rows through each pipeline's own `.withRetention` resolver |
| Monitor evaluations | Dated at the evaluated trace's end; alerts judge staleness by processing time |
| Seed | Q1 optional in-process trace backdate · Q2 span time for monitor evaluations · Q3 fixed-id private orgs before boot · Q4 per-org plan and a higher haven default · Q5 branch then main · Q6 tracking issue if one exists, else summary · Q7 every kind on `haven up` |
| Secrets | 1Password is best effort: one probe, parallel reads, skip with a warning |
| Stripe | Local and CI billing run against paymentsim |

## 3. Landed (pushed)

| Area | What |
| --- | --- |
| Upgrades | No holds; retryable `upgrade_in_progress`; defensive ClickHouse columns; graceful migration guards; runbook |
| Authorization | Every authorize member required; REST mounts need an authorization port; `authz-members-required` lint rule |
| Retention | Opt-out classes; worker classifies event rows on write again (as on main) |
| Evaluations | Monitor evaluations dated by span end; alert staleness by processing time; peer subscribers get `createdAt` |
| Seed | Plan core, protocol, checkpoint, CLI (SG1) · runner and `seed:apply` (SG3) · static coverage, 612 gaps (SG11) · telemetry backfill and chunker (SG2) · local identity grants through commands (SG4) · `haven seed` and auto-seed (SG12) |
| Sims | paymentsim (Stripe stand-in), `haven up +payment` |
| Secrets | 1Password best effort |
| CI | Preload fix (api and worker boot), chart, docs, Go and format fixes |

## 4. In flight

| Lane | Next |
| --- | --- |
| Tested-flow ledger | Missing area files, fold in the code sweep (3,103 rows), assemble the #8553 body; coordinator publishes |
| Upgrade e2e harness | First proven cell (cloud, no hybrid, small) with overlap; verdicts per invariant into #8553 |
| Retention rulings | Apply the class changes and the per-pipeline tenant resolver |
| Image + SaaS | One image booting as api/server or worker; draft PR in the SaaS repo (no deploy) |
| SG5 | Memory guard, executors, preflight, resume; measured drain rate |
| Billing binds | Five billing scenarios against paymentsim; billing test fakes |

## 5. Next, in order

1. Collect the lanes above; publish #8553; record the first harness cell.
2. Make `@langwatch/seedgen-runner` resolvable from `apps/tasks` as a dev-only dependency (never shipped).
3. Seed wave 3: SG6a startup persona, SG7 enterprise (SSO, SCIM, roles, grants, keys, billing), SG8 gateway (virtual keys, budgets, governance, webhooks), SG10 hybrid, SG16 public slice and live mode, then SG6b agent/eval.
4. Seed wave 4: SG9 time (backdated trace input, evaluation dates), SG11 run-time coverage, SG13 snapshot cache, SG14 nightly, SG15 upgradelab adopts seedgen. Wave 5: SG17 docs.
5. Remaining upgrade cells: hybrid (check whether the private-S3 refusal is stale now storagesim lists), self-hosted, then larger tiers and tenant counts.
6. Flow rounds by resource: light (dev stack only) in parallel, medium (sims and seeded data), heavy (big seed, upgrade cells, several stacks) one at a time.
7. githubsim for the GitHub flows (endpoints and webhooks from the ledger's GitHub area).
8. Upgrade docs once the harness is green: public self-hosted upgrade guide and the per-release migrations and deprecations register.

## 6. Waiting on Alex

| Item | Detail |
| --- | --- |
| Stripe secrets to 1Password | Steps in the local handoff `stripe-secrets-1password.md`: add the two fields in 1Password, delete the two Stripe lines from `.env`, add `LANGWATCH_OP_ACCOUNT`, `haven down && haven up`. Also lets `haven up +payment` use paymentsim |
| Live check of seeded grants | Needs a `haven db reset` of the local stack (wipes local data) |
| Seeding as the system caller | Record a one-line ruling that seeding may use the system caller for the fixed local identity only |
| Older held questions | Image identity; the nine held ledger questions; nx daemon for trusted worktrees; renaming the remaining "binding" vocabulary and retiring RoleBinding; branding the upgrade holding page; `pnpm dev` migrations |

## 7. Known reds not from this drive

- experiment: two REST declaration tests; organization: "member removed" answers 500.
- gateway: four virtual-key tests need a fixture another lane's change uses.
- evaluation: app tests miss the authz provider; one ClickHouse repository test type error.
- automation: two report-dispatch test type errors.
- `@langwatch/tasks` typecheck: errors in other lanes' in-flight files.

## 8. Follow-ups noted

- Delete the unused `OnePasswordUnavailableError` and its registered code.
- ADR-132's 1Password section describes the unbuilt `op://` design; amend it.
- Topic clustering runs on Python langevals on this branch; the Go engine is on `feat/langevals-go`.
- Authz read audits: confirm the emitter records each read once.
- paymentsim gaps: no proration, no automatic webhook retries, unknown parameters accepted.
- Make the worker's retention classifier required at boot.
