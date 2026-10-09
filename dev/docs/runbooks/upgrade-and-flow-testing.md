# Upgrade and flow testing: the runbook

> **What this is for.** It tests the upgrade from origin/main to this branch in three deployments
> (self-hosted; cloud, no hybrid; cloud, hybrid), and then the key product flows end to end, in
> rounds, until nothing new breaks. Humans and agents both follow it. Results go in the tested flow
> ledger, [#8553](https://github.com/langwatch/langwatch/issues/8553).
>
> **Status (2026-10-09).** One deployment runs today: `upgradelab cell -deployment cloud -tier S`.
> Everything else is marked ✅ (works), 🟡 (partly) or ❌ (missing, with the lane that owns it).
> Planned seed commands carry **(planned, SGn)**. SGn numbers come from
> `.claude/handoffs/seed-research-opus.md` §4. The frozen seed design
> (`dev/docs/plans/seed-2026-10-09.md`, being written) may renumber them, and if it does, it wins.

Sources, read in this order when a step here is unclear:

| Topic | Source |
| --- | --- |
| How the upgrade works | `.claude/skills/upgrade/SKILL.md`, `dev/docs/ARCHITECTURE.md` §7 ("Migrations are not the api's job") |
| Harness and matrix design | `.claude/tmp/handoffs/plan-upgrade-snapshots.md` (§2 matrix, §5.2 invariants I0-I11, §5.3 drills K1-K6) |
| The cell runner | `tools/upgradelab/README.md`, `tools/upgradelab/cell/` |
| Seed rulings | `.claude/handoffs/seed-rulings.md` |
| Sims | `.claude/skills/sims/SKILL.md` and one skill per sim |
| The stack | `.claude/skills/haven/SKILL.md`, `haven help <command>` |

---

## 1. One page

```text
            ┌───────────────────────── UPGRADE ROUND (per matrix cell) ─────────────────────────┐
            │                                                                                    │
 SEED ──────┼─► STORES ──► OLD RELEASE UP ──► TRAFFIC ──► CUT ──► SWITCH ──► WATCH ──► CHECKS ──┼─► REPORT
 upgradelab │   upgradelab_<cell>   origin/main     API mix +    old worker  head api  holding,   I0..I9, N1..N4,
 seed (today)│   PG + CH (+private) app + worker  ingest, from  paused, jobs first,    no holds,   H1..H3, O1,    report.md
 seedgen     │   own redis-server   start:prepare  before the   queue       worker    Ops >      logs, browser  report.json
 (planned)   │                      :db            cut to after             runs the  Upgrades   consoles       shots/
            │                                     ready                    upgrade                              │
 SNAPSHOT ──┼─► restore instead of seed (planned, L6a/L8)                                          │
            └────────────────────────────────────────────────────────────────────────────────────┘
                                                                                                    │
            ┌──────────────────────── FLOW ROUND (per flow, on head) ───────────────────────────┐   ▼
            │ own worktree + haven stack (--mode) ─► sims ─► persona seed ─► steps ─► assert in  │  #8553 row
            │ the product ─► visualdiff check / apidiff scenarios / workerrun ─► logs + consoles │  round log
            │ Plugs in: (a) on a fresh head stack; (b) on the stores a kept cell upgraded         │  fix lanes
            │ (-keep), so each flow also proves "works after upgrade"                             │
            └────────────────────────────────────────────────────────────────────────────────────┘
   Beside both: UI fuzz lanes (fuzz ui), never on a stack a cell or flow round is judging.
```

What runs today:

| Piece | State | Command or owner |
| --- | --- | --- |
| Cloud cell, tier S, shape typical | ✅ runs end to end (red findings expected) | `.bin/upgradelab/upgradelab cell -deployment cloud` |
| Hybrid cell | ❌ refuses: private S3 needs an S3 with listing | harness lane (`cell/profile.go` "hybrid") |
| Self-hosted cell | ❌ refuses: wants a release-tag worktree | harness lane (`cell/profile.go` "self-hosted") |
| Tiers L / XL, tenant counts 10 / 100+ | ❌ | L4 SNAP-GEN-SCALE, seed SG1 |
| Snapshot restore as the cell's origin | ❌ (`snapshot restore` exists, the cell does not use it) | L6a / L8 |
| Drills K1-K6 | ❌ in upgradelab (rehearsal phase 5 has LEASE, SIGKILL, CH pause, NO-OP) | L6b |
| Flow rounds on a haven stack | ✅ for every flow except hybrid flows and Go topic clustering | §4 |

---

## 2. The test matrix

Dimensions: **deployment** × **tenants** × **data shape (persona)** × **volume tier**.
Tenant counts are folded into tiers until the seed takes `--tenants` (planned, SG1).

| Tier | Tenants (orgs) | Projects / users | Telemetry | Made by | Laptop? |
| --- | --- | --- | --- | --- | --- |
| **S** | 1 (sh-free) / 3 (saas) / 4 (hybrid) | ~12 / ~40 | 2,000 traces, 10,000 spans, 2 months | `upgradelab` seed today | ✅ |
| **M** | 10 | 100 / 500 | 250k traces, 1.5M spans | (planned, SG1 + SG7) | ✅ if it fits the RAM limits (§5) |
| **L** | 100+ | 20,000 / 200,000 | 500k traces, 5M spans | (planned, L4) nightly snapshot | ❌ CI only; laptops pull and restore (D12) |
| **XL** | long tail (L × 20 clone) | ~400k projects | 100M spans | (planned, L4) clone in the stores | ❌ manual runner only |

Personas (seed rulings): `startup` (one project), `enterprise-sso` (SSO, SCIM, custom roles),
`gateway-heavy`, `agent-eval-heavy`, plus the shapes `hybrid-clickhouse` and `self-hosted`. Today's
upgradelab shape `typical` covers every product kind once and stands in for all four until the
personas land (planned, SG3-SG5).

**Must** = every migration PR and before release. **Nightly** = scheduled. **Manual** = on demand.

| # | Deployment | Tenants | Shape | Tier | Cadence | Runs today |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | Cloud, no hybrid | 3 | typical | S | **Must** | ✅ |
| U2 | Cloud, no hybrid | 10 | all personas | M | **Must** | ❌ SG1 |
| U3 | Cloud, no hybrid | 100+ | typical | L | Nightly | ❌ L4 |
| U4 | Cloud, no hybrid | long tail | typical | XL | Manual | ❌ L4 |
| U5 | Cloud, hybrid (1 private of 4) | 4 | typical | S | **Must** | ❌ private S3 |
| U6 | Cloud, hybrid (mixed, 2 private targets) | 10 | all personas | M | **Must** | ❌ |
| U7 | Cloud, hybrid | 100+ | typical | L | Nightly | ❌ L4 |
| U8 | Self-hosted, free | 1 | startup | S | **Must** | ❌ profile |
| U9 | Self-hosted, licensed (SSO, SCIM, roles) | 3 | enterprise-sso | S | **Must** | ❌ profile |
| U10 | Self-hosted, licensed | 10 | all personas | M | Nightly | ❌ |
| U11 | Cloud, Replicated ClickHouse (D11) | 3 | typical | S | Nightly | ❌ |
| U12 | Fresh install (empty) | 0 | none | - | **Must** | 🟡 rehearsal `--origin empty` |

The plan's cells C1-C19 (`plan-upgrade-snapshots.md` §2.3) also cover origins 3.20.1, 3.19.4 and
rel-N. Those are self-hosted release paths. This runbook's rounds are origin/main to head.

---

## 3. An upgrade round

### 3.0 Once per machine

```bash
# from the repo root (go.work resolves ./cmd/upgradelab)
go build -o .bin/upgradelab/upgradelab ./cmd/upgradelab
.bin/upgradelab/upgradelab --help        # expect: "upgradelab: upgrade snapshots and matrix cells"

# haven's native Postgres and ClickHouse must be up: the cell reads them from `haven db url`
haven status --agent                     # expect a healthy shared-servers block
```

Two checkouts (a person or the coordinator does this, because it is a git write):

```bash
git fetch origin main
git worktree add --detach .worktrees/upgradelab-main origin/main
git worktree add --detach .worktrees/upgradelab-head HEAD        # head = committed code only
rm -f .worktrees/upgradelab-main/.env .worktrees/upgradelab-head/.env   # a cell refuses a .env
for d in .worktrees/upgradelab-main .worktrees/upgradelab-head; do
  (cd "$d" && pnpm install --frozen-lockfile && pnpm start:prepare:files)
done
```

To move head to a newer commit: `git -C .worktrees/upgradelab-head checkout --detach <sha>`, then the
install line again. A cell never sees uncommitted edits.

### 3.1 Set up, seed and run (one command today)

```bash
RUN=.claude/tmp/upgradelab/cells/U1-$(date +%m%d-%H%M)
.bin/upgradelab/upgradelab cell -deployment cloud -tier S -shape typical -seed 1 \
  -hold 35s -keep -run-dir "$RUN" > "$RUN.out" 2>&1
echo "exit $?"     # 0 all pass · 1 an invariant failed · 2 a step stopped the cell
```

Run it in the background (it takes minutes). Never poll it in a loop. Its steps, in order:

| Step | Does | Rulings it proves |
| --- | --- | --- |
| `stores` | drops and recreates `upgradelab_<cell>` (PG schema `mydb`, CH db, CH `_p_<label>` per private target) and starts its own `redis-server` | isolation |
| `from-schema` | origin/main's `start:prepare:db` | - |
| `from-up` | origin/main's app (`runtime:app:dev`) and worker (`runtime:workers:dev`) | - |
| `seed` | tenancy SQL, seed account, every product kind through old doors | - |
| `traffic-before` | the mix below for `-before` (30 s) | - |
| `cut` | old worker paused for `-at-cut` (10 s) so jobs queue, then old processes stop | worker can be down |
| `switch` | head api starts, head worker `-worker-delay` (10 s) later; **the worker runs the upgrade** | worker runs upgrade |
| `ready` | waits ≤ `-ready-within` (6 min) for head's api to be ready | api up during upgrade |
| `settle` | waits ≤ `-settle-within` (4 min) for background steps and queues | eventually consistent |
| `checks` | judges the invariants into `report.md` / `report.json` | all |

Traffic mix (`cell/traffic.go`), fired from before the cut until `-after-ready` (20 s) after ready:

| Kind | Door | Every | Write |
| --- | --- | --- | --- |
| `otlp-trace`, `otlp-log`, `otlp-metric` | `/api/otel/v1/*` | `-rate` (1 s) | ✅ |
| `collector` | `/api/collector` | 1 s | ✅ |
| `rest-read`, `trpc-read` | REST read, tRPC read | 2 s | |
| `prompt-create`, `prompt-update`, `dataset-create` | `/api/prompts`, `/api/dataset` | 4 s | ✅ |

More load beside the cell (optional), using workerrun's URL mode with the seeded key:
`.bin/workerrun/workerrun -url <cell api origin> -families otlp,collector,scenario,batch -n 200`.
❌ The cell prints no api origin while it runs (see §7).

### 3.2 Seed or restore

| Source | Command | State |
| --- | --- | --- |
| Live seed in the cell | built into `cell` (`seed` step) | ✅ S only |
| Persona and tier seed | `haven seed --size N --days D --persona X` | (planned, SG7) |
| Snapshot restore | `upgradelab snapshot restore -from DIR -postgres URL -clickhouse shared=URL -redis URL` refuses any database not named `upgradelab_<name>` or not empty | ✅ verb; ❌ cell origin (L6a) |
| Local snapshot cache after a big seed | keyed by (code version, size, days, personas) | (planned, SG9) |

### 3.3 Switch, and what you should see

The phases the poller records (`report.md` "Api phase" table), from a real run on 2026-10-09:

```text
| Api phase             | From ms |
| down                  | 74332   |   <- old stopped, head api not yet answering
| not-ready             | 90884   |
| holding:upgrade-gate  | 91333   |
| holding:holding       | 91833   |   <- Postgres schema step outstanding: held ≤30 s then 503 (before the no-holds ruling)
| ready                 | 111857  |
```

✅ A pass has **no `down` phase longer than the restart itself**, and `upgrading` appears between
`holding` and `ready` while blocking data steps run. The 2026-10-09 run had 92 `no-answer` calls in
`down` and 115 `503` in `holding:holding`. Under the ruling ("api must be up") both are findings.

### 3.4 Watch

| What | Where |
| --- | --- |
| Holding page and the upgrading frame | `$RUN/shots/` (Playwright, one per phase; `-shots=true` is the default) |
| Ops > Upgrades | `$RUN/shots/` (signed in as the seed account, made platform operator); live at `<api>/ops/upgrades` |
| The worker running the upgrade | `tail -f $RUN/head-worker.log \| grep -i -E 'upgrade\|step'` |
| The api holding | `tail -f $RUN/head-api.log` |
| The ledger, by hand | from `.worktrees/upgradelab-head/apps/tasks`, with the cell's `DATABASE_URL` and `CLICKHOUSE_URL` exported: `node --experimental-transform-types src/main.ts upgrade status --json` (never `pnpm task`: it reads `../../.env`) |

Ops > Upgrades states to expect, in order: **Behind → Upgrading → Finishing in background → Up to
date**. **Needs attention** means a failed step: Retry is on that page (`ops:manage`).

### 3.5 Invariants and pass criteria

| Ruling or check | Pass | Cell id | State |
| --- | --- | --- | --- |
| Api up during the upgrade | head api answers from its first second; no `down` beyond process start; `/healthz` in every phase | I0, N1 | ✅ judged |
| Ingest serves while upgrading | every OTLP, collector and track post answers 2xx, or a 503 `upgrade_in_progress` with Retry-After that succeeds on retry | N1, N2 | ✅ judged |
| No holds | nothing is held; a call that reaches a schema still behind answers 503 `upgrade_in_progress` (Retry-After 10 s) and the client retries; no unanswered call | N2 | ✅ judged |
| 0 failed calls | `Failed` = 0 for every kind (eventually consistent: a retried 503 that later succeeds is not a failure) | N2 | ✅ |
| 0 lost writes, 0 dropped traces | `Lost` = 0: every 2xx write is visible after settle | N3 | ✅ |
| Queued work drains | jobs queued at the cut drain on head's worker | N4 | ✅ |
| The worker runs the upgrade | head-worker.log names the steps; head-api.log runs none | I0 + logs | 🟡 by log read |
| Ledger current | every step `done` or `not-needed` on every target; nothing `running` or `failed` | I2 | ✅ |
| Nothing reopened | no step reopened at ready | I2b | ✅ |
| Roster | api `/readyz` 200; the worker's roster row declares every image code step | I3 | ✅ |
| Copy never move (fingerprints) | no table shrank; every pre-existing event still present | I4 | ✅ |
| Seeded data reads back through head | every seeded kind counts back | I6 | ✅ |
| Second upgrade is a no-op | exit 0, no ledger or fingerprint change | I8 | ✅ |
| Logs clean | no error lines in head-api / head-worker beyond the baseline | I9 | ✅ (baseline: none accepted yet) |
| Ops > Upgrades | settles on "Up to date" | O1 | ✅ |
| Hybrid isolation | private org's rows only in its target; shared orgs never there; every CH target migrated; private reads from its target | H1, H2, H3 | 🟡 H1/H2 coded, H3 inconclusive, profile refuses |
| Migrations graceful (new guards) | `lint:architecture --policies upgrade-sign-in-tables` clean; migration-safety tests green (below); no step holds a lock past `lock_timeout` | - | ✅ static; ❌ live lock drill (K2) |
| Authz fails closed | during and after the switch: a key with no grant gets 403/401, never 200; a failed authz check is 500 with no rows, never partial (record §"Authorization fails closed") | - | ❌ no cell check; run the grants flow (§4.6) on the upgraded stores |
| Read models filled, events parse, durations, coverage | I5, I7, I10, I11 | - | ❌ L3/L7/L4 |

Static guards to run once per round, on head:

```bash
pnpm lint:architecture --policies upgrade-sign-in-tables
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/prisma-client test src/__tests__/migration-safety.unit.test.ts
VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/clickhouse-migrations test src/__tests__/migration-safety.unit.test.ts
```

Expected report header on a pass:

```text
# upgradelab cell cloud_s_typical_1
| Invariant | Name | Result | Detail |
| I0 | ... | pass | holding at … ms, upgrading mode at … ms, ready at … ms |
...
report: /…/.claude/tmp/upgradelab/cells/U1-…/report.md
```

### 3.6 Logs and consoles

| Source | Read | Look for |
| --- | --- | --- |
| Cell processes | `$RUN/{from-schema,from-app,from-worker,head-api,head-worker,redis}.log` | `grep -n -i -E 'error\|unhandled\|ProjectNotFound\|dead.?letter\|refus' $RUN/head-*.log` |
| Browser consoles | screenshot script output in `$RUN/shots/` | ❌ consoles not captured by the cell yet (§7) |
| A haven stack (flow rounds, kept cells you open in haven) | `haven errors --agent`, `haven logs api --level warn --since 30m --agent`, `haven logs worker --level warn --since 30m --agent` | new signatures vs the last round |
| A haven stack's browser | `haven page console --level error --agent`, `haven page network --failed --agent` | errors and failed requests |

A new signature is a finding even when every invariant passes.

### 3.7 Teardown

| Case | Action |
| --- | --- |
| Pass, no `-keep` | the cell drops its databases and stops its processes |
| `-keep` or a failed step | databases stay: `upgradelab_<cell>` in PG and CH (plus `_p_<label>`); drop them by hand when done (`DROP DATABASE upgradelab_<cell>` on each server) |
| Kept stores you want to flow-test | §4 "plug in after upgrade" |

### 3.8 Per deployment

| | Cloud, no hybrid | Cloud, hybrid | Self-hosted |
| --- | --- | --- | --- |
| Flag | `-deployment cloud` | `-deployment hybrid` | `-deployment self-hosted` |
| Shape env | `seed/env/saas.env` (`IS_SAAS`) + a never-sent Stripe test key | `hybrid.env`: org 4 on `CLICKHOUSE_URL__snap__<org>` and `DATAPLANE_S3__snap__<org>` | `sh-free.env` (`ADMIN_EMAILS`); `sh-licensed.env` for U9 |
| Extra invariants | - | H1 placement, H2 every target migrated, H3 private reads | operator bootstrap; licence copied (`licensing:copy-organization-licenses`) |
| Today | ✅ | ❌ `deployment hybrid cannot run yet: private S3 … needs an S3 with listing` (storagesim now has ListObjectsV2: the profile can be retried) | ❌ wants a 3.20.1 worktree; origin/main → head as self-hosted needs a profile entry without the tag |

### 3.9 Drills (from `plan-upgrade-snapshots.md` §5.3)

| Id | Injection | Expect | Today |
| --- | --- | --- | --- |
| K1 | SIGKILL `upgrade` at `blocking step <id> started` | re-run resumes; fingerprint = clean run | ❌ L6b |
| K2 | hold `ACCESS EXCLUSIVE` past `lock_timeout` × 3 | named failure; re-run converges | ❌ L6b |
| K3 | pause ClickHouse during goose (containers only) | `schema_failed` naming the target | 🟡 rehearsal phase 5 (Docker) |
| K4 | SIGKILL head worker mid background step | resumes from checkpoint; never `done` early | 🟡 rehearsal phase 5 |
| K5 | steal the runner lease | exit non-zero, re-run 0 | 🟡 rehearsal `LEASE` |
| K6 | two upgraders at once | one applies, the other names the holder | ❌ L6b |

Rehearsal (Docker, about 8 GB), for K3-K5 and rollback until L6b lands:
`bash dev/scripts/upgrade-rehearsal/rehearse.sh --origin main --build-main --build-head --order worker-first`.

---

## 4. Flow rounds

### 4.0 Common set-up (never the dev stack)

```bash
# a person or the coordinator: one worktree per flow round, at the commit under test
git worktree add --detach .worktrees/flows-<name> HEAD
cd .worktrees/flows-<name>
pnpm install --frozen-lockfile
haven up --agent -d --mode saas +llm +outbound +analytics +telemetry   # add per flow below
haven status --agent          # slug = flows-<name>; app at https://app.flows-<name>.langwatch.localhost
```

- `--mode` is one of `dev/tests/modes/*.env`: `saas`, `hybrid-dp`, `sh-free`, `sh-licensed`
  (needs `LANGWATCH_LICENSE_KEY`), `sh-connected`, `sh-instance-idp`. It sticks; `--mode none` clears.
- The worktree hook copies the root `.env` in, and its base URLs beat the overlay. If a model call
  reaches a real provider, the `.env` names `OPENAI_BASE_URL`: remove that line in the worktree's
  `.env`, then `haven down` and `haven up` again.
- Seed: `haven db seed demo` today; `haven seed --persona <p> --size <n> --days <d>` (planned, SG7).
- **Plug in after upgrade:** point a stack at a kept cell's stores (`-keep`) to prove each flow on
  upgraded data. ❌ There is no haven verb for "use these stores" yet (L9, `haven db snapshot`).
  Until then, run flows on a fresh head stack and on U1's restored snapshot once L6a lands.

Tools every flow below uses:

| Tool | Command | Proves |
| --- | --- | --- |
| visualdiff check | `go run ./cmd/visualdiff check -stack flows-<name> -only <flow ids>` (`-mark` to record passes) | UI flow, scripted, with expects |
| apidiff scenarios | `.bin/apidiff/apidiff scenarios -a https://app.flows-<name>.langwatch.localhost -scenarios 'tools/apidiff/scenarios/<name>.yaml'` (no `-b`: PASS/FAIL on one stack) | API behaviour |
| workerrun | `.bin/workerrun/workerrun -stack flows-<name> -families <list> -n 50` | worker drained, read back by id |
| interactionsimulator | `pnpm --filter @langwatch/interactionsimulator simulate run -url <app> -features <f> -budget-usd 5` (spends model money; needs AI keys from the environment) | exploratory journeys, findings |
| fuzz (beside, not on a judged stack) | `.bin/fuzz/fuzz ui -url <app> -duration 20m -reload-every 5` / `fuzz api` | crashes, 5xx |

Rows, prerequisite ids (P1, P2, …: persona or tier, sims, env flags) and claims live in
[#8553](https://github.com/langwatch/langwatch/issues/8553). The full flow list and prereq
catalogue is being written to `.claude/handoffs/flow-ledger-8553-body.md`. This runbook says **how**
to run each flow. It does not copy the rows.

### 4.1 New SSO (OIDC and SAML connections)

| | |
| --- | --- |
| Pre | `--mode saas` (or `sh-licensed`); persona `enterprise-sso` (planned, SG4); idpsim (on by default) |
| Sims | `haven idp tenants`; register the app: `haven idp apps add 1 --redirect <callback>` |
| Steps | Settings > Authentication: register a connection (DRAFT) → verify `acme1.test` (DNS TXT through idpsim: `dig @127.0.0.1 -p 15353 TXT acme1.test`) → activate → sign in as `member@acme1.test` (`haven idp signin 1 --user member@acme1.test` for IdP-initiated SAML) |
| Assert | first sign-in creates the user and membership; a confirmed local account is linked, not duplicated; `haven idp activity` shows the authorize and token calls |
| Negative | `haven idp tamper 1 bad-signature`, `skew`, `rotate-key`, `user disable`: each sign-in refuses with the named page |
| Failure signatures | stuck on the refusal page with no idpsim activity (request never arrived); duplicate user; 500 on callback |
| Bind to | `specs/e2e/sso-journeys.feature`, `specs/identity/sso-connection-lifecycle.feature`, `specs/identity/sso-assertion-refusals.feature`; flows `auth-sso-settings-overview`, `auth-sso-refusal-page` |

### 4.2 Old (legacy) SSO

| | |
| --- | --- |
| Pre | an org with `ssoDomain` / `ssoProvider` strings; `--mode saas` |
| Sims | `haven idp legacy provider 1 okta` (or `auth0`, `cognito`, `onelogin`, `azure`), then `haven idp legacy env 1`: put those lines in the worktree's `.env`, `haven down`, `haven up` |
| Steps | sign in through the legacy provider as `member@acme1.test` |
| Assert | sign-in lands in the org; nothing offers a second connection to an org already routing sign-in |
| Failure signatures | wrong-provider loop; "no sign-in route" for an org with strings |
| Bind to | `specs/auth/sso-oidc-providers.feature`, `specs/auth/sso-wrong-provider-recovery.feature`, `modules/auth/specs/sign-in-providers.feature` |

### 4.3 Migrating old SSO to new SSO

| | |
| --- | --- |
| Pre | 4.2 working; then upgrade (the grandfather system migration runs) |
| Steps | 1. run U1 with an SSO-string org (❌ the typical shape does not seed one: SG4), or on a flow stack run the system-migrations pass; 2. check the org reads as a FINALIZED connection with verification method `legacy-configuration`; 3. sign in again; 4. finish the migration and check the directory sync moves through SCIM |
| Assert | sign-in unchanged before and after; no guard weakened; a second run is idempotent |
| Failure signatures | a second connection created; members stranded; the legacy columns still editable once the flag enforces |
| Bind to | `specs/identity/sso-connection-lifecycle.feature` ("A legacy SSO organization is grandfathered without noticing", "…idempotent per organization", "…finalizes on routing agreement"), `modules/identity/specs/sso-migration-directory-move.feature`, `specs/identity/sso-domain-ownership-backfill.feature` |

### 4.4 SCIM

| | |
| --- | --- |
| Pre | an SSO org (4.1) and a SCIM token (Settings > Directory, or `specs/organizations/scim-tokens-rest-api.feature`) |
| Sims | `haven idp scim target set 1 …` with the stack's SCIM base and token, then `haven idp populate 1 --users 500 --groups 12 --seed 1`, `haven idp scim push 1`, later `haven idp churn 1 --join 20 --leave 10 --deactivate 5 --rename 5 --regroup 5` and `haven idp scim sync 1` |
| Assert | members and groups match `haven idp scim pull 1`; deactivated people lose access; departments and cost centres appear once |
| Failure signatures | drift after sync; a removed person still signs in; duplicate groups |
| Bind to | `enterprise/modules/scim/specs/provisioning.feature`, `scim-connection-sync.feature`, `scim-group-mapping.feature`, `specs/identity/scim-sso-signin.feature`; flows `scim-push-synced-groups-and-people`, `scim-provisioning-page-and-token-dialog` |

### 4.5 Revoking tokens (API keys, sessions, virtual keys, invites)

| | |
| --- | --- |
| Pre | any persona; `--mode saas` |
| Steps | create, use, revoke: project API key, personal key, service key, gateway virtual key, a session (Settings > Sessions), a pending invite |
| Assert | the revoked credential gets 401 on the next call (allow the auth-check cache's bound, `modules/api-key/specs/auth-check-cache.feature`); the revoked session is signed out |
| Failure signatures | a revoked key still answers 200 after the cache bound (**security: record as "fix pending" only**) |
| Bind to | `specs/api-keys/api-keys-v2.feature`, `specs/auth/admin-email-change-revokes-sessions.feature`, `specs/ai-gateway/cli-token-revoke-on-deactivation.feature`; flows `api-key-create-copy-revoke`, `api-key-service-create-and-revoke`, `auth-sessions-list-and-revoke`, `gateway-virtual-key-revoke-reads-back`, `members-pending-invite-list-and-revoke` |

### 4.6 Auth grants (and "authz fails closed")

| | |
| --- | --- |
| Pre | org with custom roles and groups (persona `enterprise-sso`) |
| Steps | `.bin/apidiff/apidiff scenarios -a <app> -scenarios tools/apidiff/scenarios/grants.yaml`; UI: flows `roles-access-grant-change-revoke`, `role-assign-custom-role-to-member`, `roles-access-reader-sees-roles-beyond-them` |
| Assert | every `grants-*` and `roles-*` scenario PASS; a key never raises itself; the last admin cannot be removed |
| Fails closed | with no grant, every door answers 401/403; a broken authz read answers 500 with no rows, never partial data |
| Bind to | `modules/authz/specs/grant-revocation.feature`, `expiring-grants.feature`, `permission-resolution.feature`, `cutover-gate.feature` |

### 4.7 Creating prompts

| | |
| --- | --- |
| Pre | `+llm` (playground answers from llmsim) |
| Steps | UI flows `prompt-create-and-save`, `prompt-restore-version`, `prompt-playground-run-outcome`; API `apidiff scenarios -scenarios tools/apidiff/scenarios/cv3-prompts.yaml` and `…/sdk-contract-prompts.yaml` |
| Assert | versions and tags read back through REST and the SDK; the playground call shows in `haven llm calls` |
| Bind to | `modules/prompt/specs/prompt.feature`, `prompt-version-restore.feature`; the upgrade cell's `prompt-create`/`prompt-update` kinds cover writes during the switch |

### 4.8 Coding-agent ingestion (Claude Code, Codex)

| | |
| --- | --- |
| Pre | `+telemetry` |
| Steps (sim) | `haven telemetry send --preset claude-code-session --seed 42 --batches 20 --json`, same with `codex-session`; or `.bin/workerrun/workerrun -stack flows-<name> -families claude-code,codex -n 50` |
| Expect from the sim | `state: "done"`, `acked == sent`, `refused == 0`, `failed == 0` |
| Steps (real agent) | isolate first (`dev/docs/best_practices/dogfooding-isolation.md`): `export LANGWATCH_CLI_CONFIG=$PWD/.claude/tmp/dogfood/langwatch-config.json CLAUDE_CONFIG_DIR=$PWD/.claude/tmp/dogfood/claude CODEX_HOME=$PWD/.claude/tmp/dogfood/codex`, then `langwatch login` against the flow stack and run a real interactive session in a sub-tmux (not `claude -p`) |
| Assert in the product | the session lists on the coding sessions screen; events read back (`GET /api/coding-agent/sessions/{id}/events`); token cost shows |
| Bind to | `specs/coding-agent/session-aggregate.feature`, `sessions-screen.feature`, `modules/coding-agent/specs/coding-agent-session-read.feature`; `apidiff scenarios -scenarios tools/apidiff/scenarios/coding.yaml`; flows `coding-session-list-shows-ingested-sessions`, `coding-session-events-api-reads-back` |

### 4.9 Scenarios

| | |
| --- | --- |
| Pre | `+llm` (the judge and the simulated user answer from llmsim) |
| Steps | flows `sim-create-scenario`, `sim-run-scenario`, `sim-run-suite`; API `apidiff scenarios -scenarios 'tools/apidiff/scenarios/simulations*.yaml'`; load `workerrun -families scenario -n 50` |
| Assert | runs reach SUCCESS or FAILED with a verdict; suite progress counts each run once |
| Failure signatures | runs stuck queued (orphan recovery), a missing verdict |
| Bind to | `specs/scenarios/scenario-execution.feature`, `simulation-runs-api.feature`, `modules/suite/specs/suite-progress-from-scenario-facts.feature` |

### 4.10 Voice scenarios

| | |
| --- | --- |
| Pre | `haven up +voice` (sets `ELEVENLABS_BASE_URL` to voicesim and `VOICE_UNSAFE_ALLOW_LOOPBACK_PROVIDERS=1` unless `.env` names one) |
| Steps | flows `agent-create-voice`, `sim-scenario-edit-drawer-header-and-caller-voice`; run a voice scenario against agent `agent_voicesim_seed` |
| Assert | `haven voice calls --json` lists the call (`conv_voicesim_000N`); the run shows the transcript and audio; the trace button opens the trace |
| Failure signatures | loopback refused (the switch is off), no call in voicesim |
| Bind to | `specs/simulation-testing/voice-agents/testing-elevenlabs-convai.feature`, `modules/scenario/specs/voice-run-audio.feature`, `voice-session-rest.feature`, `specs/setup/haven-voicesim.feature` |

### 4.11 Topic clustering

**Verified 2026-10-09:**

| Engine | Where | On this branch? | Started by |
| --- | --- | --- | --- |
| Python langevals (production path) | `services/langevals/evaluators/topic_clustering` | ✅ | `haven up +langevals` (sets `LANGEVALS_ENDPOINT`) |
| Pure Go | `services/nlpgo/modules/evaluators` (`POST /go/evaluators/topics/{batch,incremental}_clustering`, behind the internal secret) | ❌ only on `feat/langevals-go` (commit `f34ed27cee`, worktree `.worktrees/feat-langevals-go`) | the nlp lane (`go`) on that branch; ❌ no TS engine switch selects Go yet (`specs/evaluators/topic-clustering-go.feature`) |

| | |
| --- | --- |
| Pre | `+langevals +llm` (embeddings `text-embedding-llmsim`, naming via llmsim); at least 10 traces with input for batch mode (incremental needs 1,200 assigned) |
| Steps | `haven telemetry send --preset llm-trace --seed 7 --batches 200`, then flow `topic-clustering-manual-run-reaches-history` (manual trigger) |
| Assert | run history shows a finished run; traces carry topic and subtopic names (`analytics-topics-page`) |
| Failure signatures | warn-and-skip when `LANGEVALS_ENDPOINT` is unset; outbox retries (3 attempts, 12 min deadline) |
| Bind to | `modules/topic/specs/topic-manual-trigger.feature`, `run-history.feature`, `trace-assignment.feature`, `specs/nlp-go/topic-clustering.feature` |

---

## 5. Running rounds in parallel

| Rule | How |
| --- | --- |
| Never the dev stack | cells use their own `upgradelab_<cell>` databases and their own `redis-server` on a free port; flow rounds use their own worktree, so their own slug and databases |
| Unique names | cell store name = `<deployment>_<tier>_<shape>_<seed>` (`cloud_s_typical_1`): give parallel cells different `-seed` values or deployments; slugs `flows-<name>` |
| Stores refuse | `CheckDedicated` refuses any database not prefixed `upgradelab_`; `snapshot restore` refuses a non-empty one |
| Addresses | flow stacks by haven route only (`https://app.<slug>.langwatch.localhost`), never a port from `.env`. Cells bind kernel-picked loopback ports |
| One `.worktrees/upgradelab-*` pair | cells share the two checkouts read-only: never move head while a cell runs |
| Heavy commands | through the machine slot: `haven slot run -- <cmd>` |
| Clean up | `haven destroy flows-<name> --yes` after a flow round; drop kept `upgradelab_*` databases |

RAM on a laptop (this machine: 64 GiB, 10 CPUs; `haven limits` shows ClickHouse capped at 3 GB).
These figures are estimates: measure them with `haven status` and Activity Monitor during the first
round and correct this table.

| Load | Est. RAM | Run at once |
| --- | --- | --- |
| One cell (old app + worker, then head api + worker, redis) | 6-8 GB at the switch | ≤ 2 |
| One flow stack (`haven up` + 4 sims) | 4-6 GB | ≤ 2 |
| `+langevals` | +2-3 GB | 1 |
| UI fuzz lane (`fuzz ui`, 16 workers) | 3-5 GB | 1, on its own stack |
| Tier L or XL | n/a | never on the laptop's shared native ClickHouse (R3) |

---

## 6. Reporting

### 6.1 Rules

- **Compare runs by failing ids, never counts.** Ids are invariant ids (`N3`, `H1`), cell names
  (`cloud_s_typical_1`), flow ids (`scim-push-synced-groups-and-people`), apidiff scenario ids,
  workerrun item ids (`collector-0007`).
- Keep a **round log** at `.claude/tmp/upgradelab/rounds.md`: one block per round with date, commit,
  cells and flows run, failing ids, and new vs fixed ids since the last round.
- Then a handoff per round, `.claude/handoffs/upgrade-round-<n>.md` (template
  `.claude/coordinator/handoff-template.md`), and the #8493 dev-stack block (between
  `<!-- ledger:devstack:start -->` and `<!-- ledger:devstack:end -->`, mirrored in #7536).
- Triage each new failing id into a fix lane (one id or one cause per lane); rerun only that id when
  the fix lands; never hold a round for a fix.

### 6.2 The tested flow ledger, #8553

Every upgrade cell and every flow run is a row in
[#8553](https://github.com/langwatch/langwatch/issues/8553) (sub-issue of #8493).

| Column | Values |
| --- | --- |
| Status | ✅ passed · ❌ failed · 🟡 partial · ⏳ running · ⬜ not yet tested |
| Tested by | `@handle`, or `lane:<id>` plus model (`lane:upgrade-round-3 (Opus)`) |
| Date | `YYYY-MM-DD` |
| Evidence | a commit, run id or report path |

- **Claim** a row with a comment `claim <row id>`. Its Tested by becomes ⏳ with your handle or lane
  and the date. A claim lapses after 48 h with no update.
- **Evidence:** UI flows attach a screenshot or recording in a comment. API, worker and data flows
  give a run id, report path or commit. A ✅ needs evidence. A ❌ links its failing ids.
- Agent rows are re-checked by a person before release.
- **Never describe a security finding.** Write "fix pending".

Update a row:

```bash
gh api repos/langwatch/langwatch/issues/8553 --jq .body > .claude/tmp/8553-body.md
# edit the row in .claude/tmp/8553-body.md: Status, Tested by, Date, Evidence
gh api repos/langwatch/langwatch/issues/8553 -X PATCH -F body=@.claude/tmp/8553-body.md
gh issue comment 8553 --repo langwatch/langwatch \
  --body "2026-10-09 · U1 cloud S typical · ❌ N3 · lane:upgrade-round-3 (Opus) · .claude/tmp/upgradelab/cells/U1-1009-1430/report.md"
```

Re-fetch the body right before each edit, because other runs update it too.

---

## 7. Gaps

| ✔ | Gap | Blocks | Owner |
| --- | --- | --- | --- |
| [ ] | Hybrid profile: private S3 target (storagesim now lists; retry, or MinIO) and H3 (a client per private org) | U5-U7, hybrid isolation | harness lane (upgradelab cell) |
| [ ] | Self-hosted profile from origin/main (no release tag), and from 3.20.1 | U8-U10 | harness lane |
| [ ] | Tenant count and tiers M/L/XL in the cell (`-tier` accepts S only) | U2-U4, U6-U7, U10 | L4 SNAP-GEN-SCALE, SG1 |
| [ ] | Personas `startup`, `enterprise-sso` (with legacy SSO strings and SCIM), `gateway-heavy`, `agent-eval-heavy` | U2, U9, 4.3 | SG3, SG4, SG5 |
| [ ] | `haven seed --size --days --persona`, `--live` | flow-round seeding | SG7 |
| [ ] | Snapshot restore as the cell's origin; local snapshot cache | fast rounds | L6a / L8, SG9 |
| [ ] | Point a haven stack at a kept cell's stores (`haven db snapshot`) | flows "after upgrade" | L9 |
| [ ] | The cell prints its api origin while running (live Ops > Upgrades, workerrun beside it) | live watching | harness lane |
| [ ] | Browser console capture in the cell's Playwright shots | §3.6 | harness lane |
| [ ] | Authz-fails-closed check in the cell (an ungranted key during every phase) | ruling | harness lane |
| [ ] | "Worker runs the upgrade, api runs none" as a verdict, not a log read | ruling | harness lane |
| [ ] | Drills K1, K2, K4, K6 in upgradelab; live lock drill for the migration guards | ruling "graceful" | L6b |
| [ ] | I5 read models, I7 stored events parse, I10 bounds, I11 coverage | invariants | L3, L7, L4, SG6 |
| [ ] | Accepted log-signature baseline for I9 | §3.6 | harness lane |
| [ ] | Go topic clustering merged and selectable from TS | 4.11 on Go | langevals-go lane |
| [ ] | A typical-shape SSO-string org, so 4.3 runs inside a cell | 4.3 | SG4 |
| [ ] | The `down` phase between old stop and head start (no overlap) is a finding under "api stays up": decide whether the cell should overlap old and new apps | ruling | coordinator → Alex |
| [ ] | RAM figures in §5 measured, not estimated | parallel rounds | first round's runner |
