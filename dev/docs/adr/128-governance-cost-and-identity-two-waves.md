# ADR-128: Governance cost and identity — the bill is the total, history is never edited, people resolve at read time

**Date:** 2026-08-29

**Status:** Proposed

**Builds on:** ADR-088 (pulled usage is a priced event in the shared ledger —
every decision there stands except Decision 4, which this ADR revises),
ADR-122 (OpenAI admin puller with person-id-on-row — the pattern §9
generalizes), ADR-018 (unified substrate, hidden governance project),
ADR-034 (the speed split; why rollups are fed by our code, not database
views), ADR-015 (fold-projection replay — the rebuild machinery §4 reuses),
ADR-092 (the authorization engine §18 rides), ADR-101 (login identity —
the platform this ADR's identity tables live *beside*, never inside),
ADR-022 (the event log is the source of truth; its retention bounds replay).

**Replaces:** the unmerged identity branch (PRs #6987 → #6994 → #7001,
`feat/provider-identity-*`, closed without merging) as the identity design
of record. Every identity decision here is argued from measured provider
behaviour and requirements, not from that branch.

**Revises:** ADR-088 Decision 4. It attributed pulled cost at org/team and
left project deliberately unattributed; §8 stamps the org's governance
project as the *home* of every pulled row and separates "home" from
"spender" into different fields.

> **One line:** every AI dollar — **gateway traffic**, **provider bills**,
> **seat licences** — lands as an **append-only event** with a **raw actor
> id** and a **currency code**, folds into **one daily rollup**, and is shown
> where **the bill is the total** and our own metering only **splits** it;
> **who** spent it is resolved **at read time** from three **dated identity
> tables** this document defines — in **two waves**: money first, people
> second.

## Context

Customers running AI across providers (Anthropic, OpenAI, Azure/Copilot,
Databricks) ask three questions no single screen answers today: what did we
spend, who spent it, and which paid seats sit idle. The requirements doc
(`Q3/governance/requirements/requirements.md`) breaks this into FR1–FR8;
today FR5 (provider pulls) and FR7 (dashboards substrate) are shipped,
FR1/FR4 partial, FR2 (drill-down), FR3 (idle seats), FR8 (ROI) not started.

What exists and is reused, not rebuilt:

- **The pull platform** (ADR-088/122): 9 puller adapters writing priced,
  restatement-safe events into `gateway_budget_ledger_events`
  (`AmountNanoUSD Int64`, migration 00070, `argMax` dedup). Written but
  **read by nothing** — `readPulledUsageTotals()` has zero callers. The
  cost screen is the missing reader.
- **Gateway spend**: `gateway_spend` (`CostNanoUSD Int64`), per-request,
  with virtual-key and model dimensions.
- **The event-sourcing spine**: `event_log` as durable inbox, fold
  projections with replay (ADR-015, `replayEngine.ts`), the speed-split
  precedent (ADR-034).
- **The authorization engine** (ADR-092): permission verbs in a typed
  registry, role bindings on the org → team → project scope tree,
  principals user / group / api-key.
- **Login identity** (ADR-101 family): `Identifier`, better-auth, SCIM
  (`ee/scim/scim.service.ts` — costCenter → Department at `:110-155`,
  offboarding at `:531-556`).

What forced the decision now: the only written identity design lives on a
PR stack that is being closed unmerged; the Q3 governance commitment has a
proof-of-concept waiting on the cost view; and the longer the design lives
in heads and branches, the more it gets "remembered" instead of read.

### Hard constraints (locked in framing; excluded from every fork below)

1. **The bill is the truth.** Provider-billed money is the total; our own
   metering only splits it; any gap is shown, never netted away.
2. **History is never edited.** Money rows and events are append-only;
   corrections arrive as new rows; who/which-department is resolved at
   read time from dated facts. No back-fill jobs, ever.
3. **Identity never gates access.** Match tables and discovered
   people/agents live beside login identity, never in any permission or
   sign-in path. Discovering someone grants nothing.

### Measured provider behaviour the design must survive

All from the script kits (`databricks-scripts/`, `openai-scripts/`,
`anthropic` probes, `microsoft-copilot-scripts/`), run against real
accounts:

- **OpenAI** puts `user_id`, `user_email`, `api_key_id` on every cost row
  (1,579/1,579) — but 53% of measured spend ($153.28 of $286.85) sits on
  **deleted keys**, so resolving spend through the key roster is a trap.
- **Anthropic**'s `created_by` names the key's *creator*, not the caller
  (one person "credited" 16,265,003 of 16,265,003 tokens); `principal`
  was unset on all 57 keys; amounts arrive in **cents**
  (the 100× class of bug, #6977).
- **Azure Cost Management** returned **EUR** (25.79 EUR) on our own
  subscription, and serves `totalCostUSD` (Microsoft's own invoice-grade
  conversion) alongside — our probe requested only `totalCost`, which is
  why `50c_cost_by_service.csv` is EUR-only. App-only access is proven
  (service principal + Cost Management Reader role).
- **Copilot** has no per-seat price API and no prepaid-credit consumption
  API (proven dead ends in `KNOWN_DEAD.md`); it has SKU/roster counts
  (4 licensed / 2 enabled measured) and activity.
- **Databricks** SCIM lists people with email + IdP object id
  (`externalId` auto-matched 11/13 against Entra); service principals
  surface as bare UUIDs. Genie *serving* tokens are provably untieable to
  requests; warehouse cost prorates by statement.

## Decision

Numbered; each states why and what it rejects. §1–§8 are wave 1 (money),
§9–§17 identity and wave 2, §18–§20 cross-cutting.

### §1. One ADR, two waves, cost before identity

Wave 1 answers WHERE the money goes (company → application/source → agent →
model); wave 2 answers WHO spent it (business area → user → conversation).
Agent sits in wave 1 because its id arrives free on provider rows (Genie
space, Copilot bot, OpenAI project); business area sits in wave 2 because it
only exists by walking cost → person → dated department link. Rejects: two
separate documents (the waves share every schema decision, and wave-1 tables
must carry wave-2 columns from day one — §4).

### §2. The bill is the total; gateway detail splits it

Where a pulled bill covers traffic (same provider account, per provider/day
— the bill's finest grain):

- **Total shown = the bill.** The screen's number can be held against the
  invoice.
- **Gateway detail splits that total**: "$4.20 of the $6.00 attributed via
  gateway (per person/key/model); $1.80 not seen by gateway" — the
  unallocated share is its own line, never silently netted.
- **If gateway logs more than the bill** ($6.50 vs $6.00): the total is
  still $6.00, and the screen shows a visible "metering ran $0.50 over
  bill" variance line. No subtraction, no negative numbers.
- Both numbers are always stored and comparable; the wave-2
  estimated-vs-billed report is this variance line given its own screen.

Where no bill covers the traffic, gateway rows stand alone, labeled
*metered*. The overlap rule runs at **query time, never insert time**:
gateway rows arrive instantly, bills days later, and Anthropic restates 30
days back (#6978) — only a read-time rule survives a restated bill.
Rejects: "gateway wins the overlap" (an earlier draft rule — it made our
estimate compete with the invoice); skipping the whole bill row when
gateway detail exists (loses the unallocated remainder — a bug caught in
the comparison review); trace-estimated spend in v1 (float estimates would
dilute exact totals; see §5's reserved value).

### §3. Money is integer nano-units plus a currency code; no conversion in v1

Every stored amount is a whole number of nano-units (1 dollar =
1,000,000,000 units — the existing `CostNanoUSD` / `AmountNanoUSD` Int64
convention, `parseSummedNanoUsd()` / `nanoUsdToDecimalString()` untouched)
with a **currency code column** on every row. Anthropic's cents and
OpenAI's dollars are converted to *units* on arrival (exact integer math,
never a float). The currency column is load-bearing from day one: Azure
already returned EUR on our own subscription.

- **Never sum across currency codes.** A mixed screen shows per-currency
  totals: "$1,240 + €26", two lines.
- **No exchange-rate conversion in v1**, and we never invent a rate.
  Foundations so nothing migrates later: (a) when the biller provides its
  own converted amount, store it as a **second column at ingest** — the
  Azure puller requests both `totalCost` and `totalCostUSD` from day one
  (Microsoft's invoice-grade rate); (b) if a single-total view is ever
  demanded where no biller conversion exists: a dated rate table applied
  at read, stored rows untouched.

Rejects: converting at ingestion (rates are time-dependent; baking one in
is lossy forever); floats anywhere in stored money (the display-only
`AmountUSD Decimal` rule stands).

### §4. One daily rollup, filled by a fold projection, read through a thin service

The screen never talks to providers and never merges numbers itself:

```
gateway_spend ──(fold projection, app code)──► governance_cost_rollup_1d ──► thin cost service ──► screen
budget ledger ─┘                                                    ▲
(pulled bills)                              Postgres (names, price list) ┘
```

- **`governance_cost_rollup_1d`** — one row per day × org × ingestion
  source × cost_source × provider × model × agent × currency ×
  raw-actor-id (see Schema). **Every one of those dimensions is in the
  table's dedup key** — in a ReplacingMergeTree the ORDER BY tuple *is*
  the row's identity, and a dimension left out of it is not "stored for
  drill-down", it is silently collapsed on merge (this codebase already
  shipped that bug once: migration 00069's comment documents two budgets
  sharing a scope collapsing into one aggregate). Filled by a **fold
  projection** (our own app code on the event stream, ADR-015), **not** a
  ClickHouse materialized view: a rebuild is a replay, and a correction
  event *updates* the affected old day instead of adding to it — the
  known MV failure mode on corrected rows (and the reason ADR-034 already
  made this exact choice for trace analytics).
- **All columns on day one, wave-2 ones included** (raw actor id,
  department at time of spend). Summed rows cannot grow dimensions later.
- **Thin service in front**: computes seat money at read (§6), attaches
  names from Postgres at read (app-layer join — the codebase's standard),
  serves per-*request* drill-down from the raw tables (`gateway_spend`,
  ledger) — per-*person* aggregates come from the rollup itself, since
  raw-actor-id is a rollup dimension — joins puller health (§4a) so a
  missing day renders as "no data", and enforces §18's permissions.
- **Every read of this table must be dedup-safe** (`argMax` by `Version`
  or the IN-tuple pattern — ADR-015:98). ReplacingMergeTree dedups
  eventually, in background merges, not on write: after a restatement,
  the old and new row versions coexist until a merge runs, and a plain
  `SUM … GROUP BY` double-counts the restated day for exactly that
  window. This is an invariant with its own test anchor, not a
  performance note.
- Volume justifies the shape: pulled money arrives as daily buckets and
  per-statement rows — thousands per day, not the millions that forced
  the trace speed split. One daily grain suffices; hourly is an upgrade
  path, fan-out from source, never chained.

The projection is **one more class in the existing event-sourcing
pipeline** — the exact shape of `TraceAnalyticsRollupMapProjection`
(`trace-processing/projections/traceAnalyticsRollup.mapProjection.ts`),
which fills `trace_analytics_rollup` from the same events the trace fold
consumes and explicitly replaced a never-deployed MV. Nothing new is
invented; replay, stores, and comparator patterns already exist.

Rejects: ClickHouse MV hybrid (the evidence pack's initial lean — reversed
on correction semantics); querying raw tables with no rollup (Lago's
pattern; fine per-tenant at today's volume — the research vault's own
proposal recommended exactly this for v1 with a ~1s revisit trigger —
the red-team reopened this sequencing question and the captain
re-affirmed build-now with the corrected rationale above: the marginal
cost is one projection class in a pipeline the team already operates
and wants the control in, not new machinery); per-person pre-summed
tables with resolved names (person resolution is read-time, §10 — the
rollup's actor dimension carries only the raw id).

### §4a. Somebody notices: the pipeline watches itself

Automated pre-merge tests (Gates) catch bugs before ship; they do not
catch a projection that falls behind or a filter that misclassifies in
production. Wave 1 ships with, not after:

- **Projection lag metric**: age of the newest event folded into the
  rollup vs. the newest event in the log, per lane; alert when it
  exceeds one pull cycle.
- **Comparator tripwire, permanent**: a scheduled job re-sums the raw
  ledger/`gateway_spend` directly and diffs against the rollup per
  org/day/cost_source; any mismatch alerts. This is ADR-034's own
  discipline (its comparator + tripwire flag stayed on after release),
  imported along with its architecture.
- **Puller health surfaced, not just logged**: the thin service joins
  `IngestionSource` status so a day with no rows renders "no data since
  [last successful pull]" — distinct from a genuine $0 day. Prerequisite
  named in §20: the puller worker today never flips source status on
  repeated failure (`pullerWorker.ts` `assertRunMadeProgress`), so
  "unknown, never zero" is currently unimplementable without that fix.

The variance line (§2) already gives bill-vs-metering drift a first-class
UI; these three give the pipeline itself the same honesty.

### §5. One `cost_source` column carries channel and provider

Values: `gateway`, `pulled_anthropic`, `pulled_openai`, `pulled_azure`, …
one per pulled provider. Filtering this column is how "show separately"
and "show combined" are the same table.

- **`seat` is never a value** — seat money is computed at read, never
  stored as rows (§6).
- **`trace` is reserved now, excluded in v1** — the column value exists
  (columns-from-day-one) but the service filters it out and its
  projection only turns on after the exclusion filter (§7) exists.

### §6. Seat counts are durable events; seat money never is

Each day the roster puller writes an event: *"provider reported N seats of
type X."* Money is the multiplication, done at read: count-event × dated
price list (which **we maintain** — no API publishes seat prices, proven
for Copilot). A wrong price never poisons storage; fix the list and every
screen heals, because the stored event only ever claimed a count, which
stays true. Roster history is frozen: January's count lives in January's
events after people leave in March.

If a roster-reported licence type has **no matching price row**, the
screen shows "N seats — price missing", never a silent zero: the count
must not drop out of the sum through an inner join. (The failure
red-team caught this as an unstated behaviour.)

Rejects: storing seat dollars (bakes price-list mistakes into history);
pure compute-at-read with no events (loses roster history — the count on
a past date becomes unknowable).

### §7. Every dollar has one home; the exclusion filter ships before the rollup goes live

Gateway, provider-bill, and seat channels are separately labeled and never
double-count. The designed-but-unbuilt exclusion filter becomes real: its
job under §2 is marking which gateway traffic corresponds to a pulled bill
so the combined view counts each dollar once. The evidence pack ranks the
missing filter as risk #1; it is a **blocking prerequisite** of turning
the rollup projection on, not a fast-follow.

### §8. Pulled money's home is the governance project; the spender fields stay empty (revises ADR-088 Decision 4)

One field was answering two questions. Today's code leaves pulled money's
project **empty** (`pulledUsageRecord.ts:198-202`, `projectId: null`)
because stamping one "would look like that project spent it." Those are
two questions, two fields:

- **Home** (`projectId`): every pulled row is stamped with the org's
  hidden governance project (ADR-018) on arrival — we pulled it; we know
  where it lives. Pulled data's home is shown on **dedicated governance
  screens gated by §18's permission verbs** — the hidden project itself
  stays hidden. It never starts appearing in the project switcher, RBAC
  pickers, CLI project lists, or any general listing: the six
  `internal_governance` exclusion filters
  (`organization.prisma.repository.ts:757`, `team.service.ts:316,368`,
  `teams/[[...route]]/app.ts:301`, `cliAuthProjects.ts:78,132`,
  `scopeResolver.ts:353`) and the `ui-contract.feature` invariants are
  **unchanged**. (The second-order red-team caught the earlier wording
  "becomes visible to admins" as ambiguous between these two readings;
  this is the ruling: dedicated screen, filters untouched.)
- **Spender** (person / team / department): empty until identity fills
  them, and **never inferred from the home**.

Stamping the home cannot leak into enforcement: budget resolvers and
personal-usage reads gate on the structural `Scope` column
(`Scope='pulled'` excluded, migration 00082), not on `projectId` —
verified by the red-team, unchanged here.

ADR-088's "treat project as unattributed" conflated the two; this
separation keeps its real goal (never lie about who spent) while giving
every row a tenant home.

### §9. Money rows carry the provider's raw actor id, stamped at ingest, never edited

Whatever the provider said — `user_email`, Anthropic member id `user_…`, a
UUID — lands in a raw actor-id column plus an actor-kind hint. ADR-122
already does this for OpenAI; it becomes the rule for every source. WHO
that is, and which department they were in **on that date**, is answered
at read time from dated facts (§11, §13). Rejects: back-filling person or
department ids onto old rows when identity ships — that edits history to
match today (Maria's January spend would silently move to Engineering
after her March transfer, and every re-org would trigger a rewrite job).
Old rows are facts; the lens moves, the facts don't.

### §10. Five actor kinds, all first-class: people, agents, API keys, seats, service accounts

- **Service accounts** (machine logins — Databricks service principals
  and kin) are their own kind, detected **deterministically**: Databricks
  SCIM lists people with email + IdP object id while service principals
  surface as bare UUIDs. A UUID in `executed_by` is a service account,
  never lumped into "agent" — agent-adoption numbers must not include
  plumbing. Honesty note: our own measured "68% of statements by service
  principal" is an ingestion artifact (273/443 statements came from our
  own tooling — undici/curl/urllib/node per
  `20b_query_history_by_app.csv`); the ADR ships the mechanism, not that
  number.
- **Agents** are first-class discovered records (Genie space, Copilot
  bot, OpenAI project) with cost attached where the provider allows
  (OpenAI per project ✓; Genie via warehouse proration only — serving
  tokens provably untieable; Copilot money stops at billing-plan grain).
  Agent-level **activity** works everywhere; the column says which it is
  showing. Discovering an agent grants nothing.

### §11. The identity wave stands on three Postgres tables, defined here

Defined fresh in this document (the closed branch is design debris, mined
for nothing), argued from scripts and scenarios:

1. **`DiscoveredPerson`** — a name-text seen on provider rows ("the
   provider told us someone called m.silva exists"), one row per
   provider-scoped identity, with the raw id, kind, first/last-seen, and
   evidence fields. Not a login. Not a platform user.
2. **`DiscoveredAgent`** — same shape for non-human actors (spaces, bots,
   provider projects), plus provider-native metadata (workspace, plan).
3. **`IdentityMatch`** — the dated match table: "`user_abc123` on
   Anthropic = platform user #42, **valid from March 3**" (and closed
   when it stops being true — offboarding closes links). Each row records
   the **evidence kind** that created it and when. Append-only in spirit:
   a correction closes the old row and opens a new one; nothing is
   silently rewritten.

Postgres because the volume is small (hundreds–thousands of rows),
relational (uniqueness on provider + raw id, foreign keys to
Organization), and served to admin screens via Prisma like every other
app table. ClickHouse rows stay pure (raw ids only) and join at read in
the app layer — the pattern the whole codebase uses. Rejects: ClickHouse
residence (admin-curated rows are what it is worst at); a Postgres → CH
sync (infrastructure for a problem app-layer joins don't have yet).

### §12. Proof connects itself; guesses wait for a human; conflicts always stop the machine

The match policy for `IdentityMatch`:

- **Deterministic evidence links automatically**, recording which
  evidence and when: exact directory-id equality (SCIM `externalId` =
  provider id — 11/13 Databricks users matched this way) and exact
  verified-email equality.
- **Anything weaker only suggests** — "m.silva" resembling "Maria Silva"
  creates a suggestion an admin confirms. Nothing ever merges two people
  automatically.
- **Conflict rule (the two-m.silvas safeguard):** if evidence points at
  two candidates, or new evidence contradicts an existing link (a
  provider id already linked to someone else), automatic linking
  **suspends for that identity** and flags a human. Directory ids cannot
  collide (unique by construction); the risk lives in email evidence —
  shared mailboxes, and addresses re-issued to new hires. Re-issued
  emails are survivable *because links are dated*: the leaver's link
  closes at offboarding, the new hire gets a new link, and January's
  spend stays with January's person.
- A collision-review screen is future work (Open questions), flagged per
  the framing ruling.

Rejects: human-confirms-everything (a 500-person org gets a 500-click
onboarding for matches the directory already proves, and until clicked
all spend reads "unknown person"); auto-linking look-alikes (a wrong
guess routes someone's spend to the wrong person silently).

### §13. Reorgs: spend stays where it happened

Person → department links are dated (SCIM `costCenter` → Department where
available). January's spend stays with January's department; the read
resolves against the link that was open on the row's date. Orgs without
SCIM degrade to "unassigned", never break.

### §14. Provider attribution rules, written once

- **Anthropic**: a fourth bucket, **"key owner — not spender"** —
  `created_by` names the key's creator, and one measured account credited
  one person with 100% of tokens through it. Key names are stored as
  *hints* (`claude_code_key_rogerio_*` is signal), never as attribution.
- **OpenAI**: the label is **"attributed to", never "spent by"**, and
  spend is never resolved through the key roster — 53% of measured spend
  sits on deleted keys. The `user_id`/`user_email` on the cost row itself
  is carried per §9.
- **Copilot**: three sources on one screen — seat cost (our price list ×
  roster), real daily spend (Azure Cost Management, for pay-as-you-go
  customers who grant the role), activity (conversation counts). Prepaid
  customers see an honest "prepaid credits are not readable by any API"
  note — proven, not assumed.
- **Databricks/Genie**: warehouse cost prorated per statement
  (`shareOf()`); Genie serving tokens are named unattributable rather
  than guessed.

### §15. Restated bills: recompute, plus a visible marker

When a provider restates history, the affected day's number updates (bill
is truth) and the row keeps a marker: **"revised [date], was $X."** Cheap
because append-only events already hold both versions (the `argMax`
pattern); the fold projection sets two extra fields when a correction
touches an old day. The marker is a **convenience for the summary row
and holds only the latest revision**: a day restated twice shows only
the most recent "was $X" — the full chain is recoverable from the event
log, never from the rollup row. This is a deliberate, stated exception
to the resolve-at-read philosophy (a denormalized display hint, not
derived truth). Exports and API responses carry the revised flag so
finance can explain a changed number. Not in v1: revision-history
screens, diffs, notifications — the event log retains everything if ever
needed. Rejects: silent recompute (unreconcilable exports);
freeze-after-N-days (our screen would knowingly disagree with the
provider's own console).

### §16. Idle seats split across the waves (FR3)

- **Wave 1, the aggregate**: "you pay for N seats, M were active" per
  provider — SKU/roster counts × a distinct-count over raw actor ids on
  usage rows. No identity needed.
- **Wave 2, the names**: listing *which* seats are idle requires the
  roster ↔ usage-actor join (§11). Idle default: no activity for 30 days,
  adjustable per org; last-activity date always shown.
- FR3 is **partially** met in wave 1, met in wave 2 — the ADR says so
  rather than rounding up.

### §17. LWQL cost queries are wave 2 or later (FR7); FR6 and FR8 are out of scope, with reasons

Wave 1 ships the built-in screen only. LWQL is one-project-per-query
fail-closed (`provisioning.ts:380-393`) and org-wide cost cuts across
projects — its own design pass. **FR8 (ROI)**: the money half ships in
wave 1; the *value* half (time saved, output produced) has no data source
in any provider API or script we ran, and stays out until a value signal
exists. Rejects: shipping "activity per dollar" as a proxy — it is
usage-efficiency and would get quoted as ROI. **FR6 (retention)** stays
deferred as before.

### §18. Access rides the authorization engine; identity tables never do

Cost and identity screens are governance-centralized and gated by new
permission verbs in the ADR-092 registry (e.g. `governance_cost:view`,
`governance_identity:manage`), granted via role bindings on the existing
org → team → project scope tree to users or groups. What a viewer *sees*
narrows with scope (a team-scoped viewer sees their team's slice). The
identity tables are **data on those screens, never inputs to the
permission decision** (hard constraint 3). Discovered people do not get
sign-in; a promotion path (invite discovered person → platform user) must
exist for customers who want it.

### §19. This is a governance one-off, not a company platform

Built for the governance screens, reusing the existing substrate. No
shared "cost platform" abstraction is declared: we are at n=1, and an
abstraction built now would be shaped like its first caller. If another
team wants cost numbers later, that is the third-occurrence test, taken
then.

### §20. Prerequisites assumed solved, named

- **Azure cost puller** — built before this starts (Sergio); the ADR
  assumes the data lands, pulling `totalCost` + `totalCostUSD` (§3).
- **Audit single-copy** — the 9 adapters' direct-insert audit path
  becomes journal-backed on the infra track
  (`governance/pending/audit-single-copy-infra-track.md`); not an ADR
  risk.
- **Puller status must flip on repeated failure** — today
  `assertRunMadeProgress` (`pullerWorker.ts:261-289`) raises but never
  marks the `IngestionSource` unhealthy, so a silently-failing puller is
  indistinguishable from a $0 day. §4a's "no data since [date]" render
  depends on this fix; it ships with wave 1.
- The broken `openai_compliance` / `claude_compliance` sources are
  replaced/retired per ADR-122's diagnosis, outside this document.

## Constants

| Name | Value | Purpose |
|---|---|---|
| Nano scale | 1 unit = 10⁻⁹ of one currency unit; $1 = 1,000,000,000 units | exact integer money math; matches `CostNanoUSD`/`AmountNanoUSD` |
| `cost_source` values | `gateway`, `pulled_anthropic`, `pulled_openai`, `pulled_azure`, `trace` (reserved, excluded v1) | channel + provider in one filterable column; `seat` never appears |
| Rollup table | `governance_cost_rollup_1d` | the one summed table charts read |
| Rollup grain | 1 day (`toDate`) | matches bill grain; volume is thousands/day |
| Idle-seat default | 30 days without activity, per-org adjustable | FR3 wave-2 listing |
| Permission verbs | `governance_cost:view`, `governance_identity:manage` (registry names final at implementation) | ADR-092 registry entries gating the screens |
| Feature flags | `release_ui_ai_governance_enabled`, `release_ui_governance_billed_cost_enabled` | staged rollout of the screens |
| Anthropic restatement window | 30 days back (#6978) | why overlap/dedup rules are read-time only |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| Bill = total | per provider/day with a bill: displayed total equals the bill; gateway split + unallocated line sum to it exactly | query-time §2 rule; test: split + unallocated = bill for seeded over- and under-metered days |
| No cross-currency sums | no query ever adds amounts with different currency codes | `CurrencyCode` in the rollup's ORDER BY (dedup key) and every group key; test: mixed EUR/USD seed renders two totals |
| Full-grain dedup key | the rollup's ORDER BY equals its full dimension tuple — no dimension exists only as a payload column | schema review gate; test: two actors (and two currencies) sharing all other dimensions on one day, `OPTIMIZE … FINAL`, sum still equals both rows |
| Dedup-safe reads | every query on the rollup uses `argMax`/IN-tuple (ADR-015:98), never plain SUM | thin-service query helpers; test: seed pre- and post-restatement versions of one day *without* OPTIMIZE, read must return only the restated amount |
| Rebuild = replay | dropping `governance_cost_rollup_1d` and replaying events reproduces it exactly | ADR-015 fold projection; test: replay equality on seeded corrections |
| One dollar, one home | a dollar appears in exactly one channel of the combined view | §7 exclusion filter, blocking prerequisite; test: gateway row covered by a pulled bill is excluded from the combined total once |
| Pulled rows never enforce | no budget resolver ever reaches `Scope="pulled"` rows | structural, ADR-088 Decision 3 (unchanged) |
| Raw ids stay raw | actor-id columns contain only what the provider sent; no resolved name or person id is ever written into a money row | §9; code review gate + test: ingest path has no identity lookup |
| Identity grants nothing | no authz code path reads `DiscoveredPerson`/`DiscoveredAgent`/`IdentityMatch` | hard constraint 3; test: authz engine module has no import of identity tables |
| Matches are dated and evidenced | every `IdentityMatch` row has evidence kind + validFrom; corrections close and reopen, never rewrite | §11/§12; unique-open-link constraint + test |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Provider admin APIs stay pull-accessible at current auth scopes | that provider's billed lane goes dark; screens show "no data since [last pull]", never zero — backed by the §4a `IngestionSource` health join, not by hope; FR5 coverage shrinks, design survives |
| Volume stays thousands of rows/day (daily buckets, per-statement rows) | millions/day would force hourly grain + ADR-034-style routing; upgrade path exists, fan-out not chaining |
| One writer per money lane | a second writer stamping the same spend breaks one-dollar-one-home; guarded by the exclusion-filter invariant test |
| `event_log` retention covers the replay horizon (ADR-022: retention is the durability ceiling) | rollup days older than retention keep their last projected values and cannot be rebuilt; restatement markers on those days freeze |
| SCIM/Entra directory data flows for department links | orgs without it degrade to "unassigned" department; per-person drill still works via provider-native ids |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| ClickHouse migration adding `governance_cost_rollup_1d` | no (schema) | large | human review + migration ships with tested down path |
| Prisma migration adding the three identity tables + seat price list | no (schema) | large | human review + tested down path |
| Rollup fold projection | yes (replayable) | large | automated: replay-equality test + both feature flags off until §7 filter merged |
| Exclusion filter | yes | large (money correctness) | automated: one-dollar-one-home test suite is a merge blocker for the projection |
| Auto-link on deterministic evidence | yes (links are dated; closing reverses) | medium | automated: conflict-rule tests (two candidates → suspend + flag); no fuzzy path exists in code |
| GDPR erasure blanking person references | no | large | human review, always; erasure blanks person fields, money amounts stay |
| Screens behind flags | yes | small | none — ship it |
| Seat price list edits (admin) | yes (recompute at read heals) | small | none — audit-logged, no approval step |

## Schema

Sketches; exact DDL lands with the first migration PR.

```sql
-- ClickHouse: the one summed table (fed by fold projection, NOT an MV)
CREATE TABLE governance_cost_rollup_1d (
    Day                Date,
    OrganizationId     String,
    IngestionSourceId  String,        -- '' for gateway rows
    CostSource         LowCardinality(String),  -- §5 values
    Provider           LowCardinality(String),
    Model              LowCardinality(String),  -- '' where the bill has no model grain
    AgentId            String,        -- provider-native (space/bot/project), '' if none
    RawActorId         String,        -- §9: exactly what the provider said
    ActorKind          LowCardinality(String),  -- person|agent|api_key|service_account|unknown
    CurrencyCode       LowCardinality(String),  -- §3: part of every group key
    AmountNano         Int64,         -- billed or metered amount in nano-units
    BilledAmountNano   Int64,         -- provider-billed portion (0 for pure gateway rows)
    BillerUsdNano      Int64,         -- biller-provided USD conversion (Azure totalCostUSD), 0 if none
    ExactOrEstimate    LowCardinality(String),  -- ADR-088 Decision 6, carried through
    RevisedAt          Nullable(DateTime),      -- §15 marker (latest revision only)
    PreviousAmountNano Nullable(Int64),         -- §15 "was $X" (immediately-prior amount)
    Version            UInt64                   -- projection write version; reads argMax on this
) ENGINE = ReplacingMergeTree(Version)   -- projection writes whole corrected rows
ORDER BY (OrganizationId, Day, CostSource, IngestionSourceId,
          Provider, Model, AgentId, CurrencyCode, RawActorId);
-- The ORDER BY is the dedup key and MUST equal the full dimension tuple:
-- any dimension omitted here is silently collapsed on background merge
-- (distinct actors' or currencies' money deleted, not just hidden — the
-- 00069 bug class). Low-cardinality columns lead so chart scans read a
-- cheap prefix; RawActorId sits last so per-person cardinality never
-- widens the prefix. ActorKind stays out: it is determined by
-- (provider, RawActorId), never a distinguishing dimension.
-- ALL reads must be dedup-safe (argMax(col, Version) or IN-tuple,
-- ADR-015:98) — dedup is eventual, plain SUM double-counts mid-merge.
```

```prisma
// Postgres: identity tables (§11) — beside ADR-101, never inside it
model DiscoveredPerson {
  id             String   @id @default(nanoid())
  organizationId String
  provider       String            // "anthropic" | "openai" | "databricks" | ...
  rawActorId     String            // what the provider calls them (§9's join key)
  displayText    String            // name/email text as seen, verbatim
  kind           String            // person | service_account (deterministic, §10)
  firstSeenAt    DateTime
  lastSeenAt     DateTime
  @@unique([organizationId, provider, rawActorId])
}

model DiscoveredAgent {
  id             String   @id @default(nanoid())
  organizationId String
  provider       String
  rawAgentId     String            // Genie space / Copilot bot / OpenAI project id
  displayText    String
  metadata       Json              // workspace, plan — provider-native, no credentials ever
  firstSeenAt    DateTime
  lastSeenAt     DateTime
  @@unique([organizationId, provider, rawAgentId])
}

model IdentityMatch {
  id                 String    @id @default(nanoid())
  organizationId     String
  discoveredPersonId String    // the provider-side identity
  userId             String?   // platform user; nullable — GDPR erasure blanks it, row and dates remain
  evidenceKind       String    // directory_id | verified_email | human_confirmed
  validFrom          DateTime
  validTo            DateTime? // open link = null; offboarding/correction closes, never rewrites
  createdAt          DateTime  @default(now())
  // at most one OPEN link per discovered person — enforced with a partial unique index
  // (raw SQL in the migration: UNIQUE (discoveredPersonId) WHERE validTo IS NULL)
}

model SeatPrice {
  id             String    @id @default(nanoid())
  organizationId String
  provider       String
  licenseType    String              // SKU / plan name
  priceNano      BigInt              // per seat per billing period, nano-units
  currencyCode   String
  validFrom      DateTime            // dated — price changes are new rows (§6)
  validTo        DateTime?
}
```

Seat counts are **events** on the existing spine ("provider reported N
seats of type X on day D"), not a table here; the roster puller appends
them like every other pull.

## Rejected alternatives

- **Two documents (cost ADR + identity ADR)** — the waves share schema;
  wave-2 columns must exist in wave-1 tables.
- **Gateway wins the overlap** — made our estimate compete with the
  invoice; replaced by §2.
- **Skip the bill row when gateway detail exists** — loses the
  unallocated remainder.
- **ClickHouse MV for the rollup** — over-counts on corrections; fold
  projection replays instead (§4, ADR-034's own reasoning).
- **Query raw tables, no rollup** — fine per-tenant at today's volume
  (Lago's pattern, and the vault proposal's own v1 recommendation).
  Reopened by the red-team, re-affirmed by the captain: the rollup is
  one projection class in the pipeline we already operate, not new
  machinery — build now (§4, Revisions v2).
- **Store seat dollars** — bakes price mistakes into history (§6).
- **Back-fill person/department onto old rows** — edits history to match
  today (§9).
- **Auto-link name look-alikes** — silent misattribution (§12).
- **Human confirms every link** — 500 clicks for proven matches (§12).
- **Identity tables in ClickHouse, or synced into it** — wrong tool;
  app-layer joins are the codebase standard (§11).
- **Our own FX rates, or FX at ingestion** — lossy forever; biller-grade
  conversion or nothing (§3).
- **"Activity per dollar" as ROI proxy** — would get quoted as ROI (§17).
- **Company-wide cost platform** — abstraction at n=1 (§19).
- **Freeze restated days after N days** — disagrees with the provider's
  own console (§15).

## Consequences

**Positive.** Pulled money finally has a reader; totals reconcile against
invoices by construction; identity lands without rewriting a single money
row; a provider restating history updates screens with an explainable
marker; the closed PR stack is replaced by a document, not by memory.

**Negative.** Two sources of truth per overlap (bill + metering) must be
explained in the UI forever — the variance line is a permanent tenant.
Mixed-currency orgs see two totals until a biller-converted column or a
rate table exists. The exclusion filter is a hard blocker on the rollup
going live — schedule risk sits there. Seat money computed at read means
exports must run the same multiplication (one shared code path, or
numbers drift). Read-time identity resolution makes per-person queries
join-heavy; acceptable at current volume, revisit if drill-downs slow.

**Neutral.** ADR-088's machinery is untouched except Decision 4's
attribution. Pulled data's home gets a dedicated, permission-gated
governance screen; the hidden-project exclusion filters and
`ui-contract.feature` invariants are unchanged (§8). Wave 2 needs no new
money tables, only the identity tables and read paths.

## Open questions

| Question | Owner |
|---|---|
| Collision-review screen for suspended auto-links (§12) — shape and priority | Sergio (flagged for pending/) |
| Email re-issue policy detail: minimum evidence to *reopen* a closed identity under a reused address | identity implementer |
| Genie serving-token attribution — revisit only if Databricks exposes request-level linkage | watch provider changelog |
| Copilot prepaid-credit visibility — revisit if a consumption API ever ships | watch provider changelog |
| LWQL org-wide cost surface (§17) — own design pass, wave 2+ | deferred |
| Registry-final permission verb names (§18) | implementation PR |

## Revisions

- **v2 (2026-08-29, captain: Sergio Esteban).** Red-team round: five
  independent adversarial reviews (correctness, scale, failure,
  second-order effects, alternatives), each attacking the draft with
  repo evidence; all five returned "dies" on specific findings, all
  folded in:
  - **The rollup's dedup key was wrong** (correctness + scale + failure
    converged): `RawActorId` and `CurrencyCode` were payload columns,
    not in ORDER BY — in ReplacingMergeTree that deletes one actor's (or
    one currency's) money on background merge, the migration-00069 bug
    class. Fixed: ORDER BY now equals the full dimension tuple;
    `Version` declared; full-grain-key and dedup-safe-read invariants
    added with test anchors (§4, Schema, Invariants).
  - **"Unknown, never zero" had no mechanism** (failure): §4a adds the
    `IngestionSource` health join and §20 names the puller status-flip
    prerequisite; §6 adds the "price missing" render for unpriced seat
    types.
  - **Zero operability surface** (alternatives): §4a adds projection-lag
    metric, permanent rollup-vs-raw comparator tripwire, and puller
    health rendering — ADR-034's own release apparatus, imported.
  - **§8's "visible to admins" was ambiguous** (second-order) against
    six `internal_governance` exclusion filters in code: ruled as
    dedicated permission-gated screens, filters untouched. Confirmed
    safe: home-stamping cannot leak into enforcement (Scope column
    gates, not projectId).
  - **§15's marker limitation stated**: latest revision only; chain in
    the event log.
  - **One locked ruling reopened and re-asked, not silently re-decided**:
    rollup-now vs direct grouped queries first (the vault proposal's own
    v1 recommendation, with the rollup buildable losslessly later via
    replay). The captain re-affirmed **build now**, on a corrected
    rationale: the draft's "cross-org dashboards" justification was a
    drafting error (nothing in FR1–FR8 is cross-org), and the honest
    case is that the projection is one more class in the existing
    event-sourcing pipeline (the `TraceAnalyticsRollupMapProjection`
    shape) — the team already operates that machinery and wants the
    control in its own pipeline, so the waiting-saves-machinery argument
    largely dissolves.
- **v1 (2026-08-29, captain: Sergio Esteban).** Initial draft from the
  parc-fermé ceremony: framing round (decision scope, forcing function =
  stack closure + Q3 commitment with a waiting POC, blast radius =
  customer-facing money, three hard constraints), six prior interactive
  rounds (2026-08-27/28, logged in the research vault's
  `fable-analysis/02-decisions.md` — 29 rulings), and one final fork
  round (governance one-off; Postgres identity home; proof-auto-links
  with conflict suspension; repo placement). Notable overrides along the
  way, recorded so the reasoning survives: "gateway wins" replaced by
  bill-is-total (§2, Sergio); MV replaced by fold projection (§4, adopted
  from the independent Opus review); seat money stored → computed at read
  over durable count events (§6, Sergio's event-sourcing framing).
  Dissent recorded: the Opus review proposed back-filling person ids onto
  historical rows — rejected (§9) as editing history; its bill-row dedup
  skipped whole rows — rejected (§2) as losing the remainder.
