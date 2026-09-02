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

> **One line:** every AI dollar — **gateway traffic** and **provider
> bills** — lands as an **append-only event** with a **raw actor id** and
> a **currency code**, folds into **one daily rollup**, and is shown where
> **the bill is the total** and our own metering only **splits** it;
> **seat counts** land as separate events whose money value is derived at
> read time from count × dated price list (§6); **who** spent it is
> resolved **at read time** from three **dated identity tables** this
> document defines — in **two waves**: money first, people second.

## Context

Customers running AI across providers (Anthropic, OpenAI, Azure/Copilot,
Databricks) ask three questions no single screen answers today: what did we
spend, who spent it, and which paid seats sit idle. The Q3 governance
requirements break this into eight functional requirements, FR1–FR8;
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
accounts — each a **single account** (n=1), so account-level
configuration may differ per customer. Claims marked *unprobed* are
documentation-derived, not measured; §20 names the probes that must run
before the relying code ships:

- **OpenAI** puts `user_id`, `user_email`, `api_key_id` on every cost row
  (1,579/1,579) — but 53% of measured spend ($153.28 of $286.85) sits on
  **deleted keys**, so resolving spend through the key roster is a trap.
- **Anthropic**'s `created_by` names the key's *creator*, not the caller
  (one person "credited" 16,265,003 of 16,265,003 tokens); `principal`
  was unset on all 57 keys; amounts arrive in **cents**
  (the 100× class of bug, #6977).
- **Azure Cost Management** returned **EUR** (25.79 EUR) on our own
  subscription (`50c/51c_cost_by_service.csv`); app-only access is
  proven (service principal + Cost Management Reader,
  `51_sp_cost_access.sh`). `totalCostUSD` (Microsoft's own
  invoice-grade conversion) is **unprobed** — no script ever requested
  it; a §20 probe before the Azure puller ships.
- **Copilot** prepaid credits are **invisible to Azure Cost Management**
  — measured, not assumed: on our own prepaid tenant the cost feed
  returned six month-to-date lines (largest EUR 25.79 Azure Databricks)
  and **no Copilot line at all**, because prepaid credit packs create no
  Azure resource to bill against (`configuration.md`, "What we proved").
  That is the full extent of what is proven. This ADR previously called
  prepaid consumption a "proven dead end" citing a `KNOWN_DEAD.md` that
  exists in neither the repo nor the vault; the claim is **withdrawn**
  as stronger than its evidence. The research note is explicit that the
  Microsoft 365 admin centre *does* render month-to-date credits **per
  agent** — the detail we want — and that our search for the interface
  behind that screen was "a failed search, not proof that none exists".
  §21 therefore never infers prepaid from data, and §20 carries the
  probe. The per-seat price API's *absence* is separately reasoned from
  the licensing model, not a probe — no probe can prove a negative. It
  has SKU/roster counts (4 licensed / 2 enabled measured) and activity.
- **Databricks** query history shows humans as **emails** and service
  principals as **bare UUIDs** — proven *under app-only
  service-principal auth* (`51_by_user.csv`; the probe's own client id
  is one of those UUIDs). SCIM listing of people under that same
  app-only auth is **unprobed** (the script ran but no output artifact
  survives, and its curl would pass a 403 silently); the 11/13 Entra
  `externalId` match exists in prose notes only. The research itself
  later corrected course (2026-08-20): **email is the primary join key** —
  `externalId` exists only for IdP-provisioned users, refreshes daily,
  and Databricks advises against building on it. Genie *serving* tokens
  are provably untieable to requests; warehouse cost prorates by
  statement.

## Decision

Numbered; each states why and what it rejects. §1–§8 are the money
design — wave 1 ships the lanes **independent**; §2's interconnection
and §7's mapping ship in **wave 2** (ruled by Sergio 2026-08-29) —
§9–§17 identity and wave 2, §18–§22 cross-cutting.

### §1. One ADR, two waves, cost before identity

Wave 1 answers WHERE the money goes (company → application/source → agent →
model); wave 2 answers WHO spent it (business area → user → conversation).
Agent sits in wave 1 because its id arrives free on provider rows (Genie
space, Copilot bot, OpenAI project); business area sits in wave 2 because it
only exists by walking cost → person → dated department link.

**In wave 1 the money lanes are independent.** Billed, gateway and seat
numbers appear side by side, each labeled, and are **never summed into
one figure** — summing a billed lane and its own gateway metering would
count the same dollars twice. Connecting the two lanes (which gateway
traffic a bill pays for, the split, the variance line) is **wave 2**,
because it needs the §7 key-to-bill mapping and its schema. §2 below is
the already-ruled design for that connection, stamped wave 2 so nothing
gets re-litigated when it ships.

Rejects: two separate documents (the waves share every schema decision,
and wave-1 tables must carry wave-2 columns from day one — §4).

### §2. The bill is the total; gateway detail splits it (interconnection — ships wave 2)

**Wave 1**: the billed lane shows the bill, the gateway lane shows
metering, separately labeled, no combined figure (§1). Everything below
is the ruled design for the **wave-2** connected view.

Where a pulled bill covers traffic (per provider/day — the bill's finest
grain; *which* gateway traffic a bill covers is the admin's key mapping,
§7):

- **Total shown = the bill.** The screen's number can be held against the
  invoice.
- **Gateway detail splits that total**: "$4.20 of the $6.00 attributed via
  gateway (per person/key/model); $1.80 not seen by gateway" — the
  unallocated share is its own line, never silently netted.
- **If gateway logs more than the bill** ($6.50 vs $6.00): the total is
  still $6.00, and the screen shows a visible "metering ran $0.50 over
  bill" variance line. No subtraction, and no negative numbers *invented
  by us* — a provider's own refund can make a billed day genuinely
  negative (bill composition, below), and that renders as-is.
- Both numbers are always stored and comparable; the wave-2
  estimated-vs-billed report is this variance line given its own screen.
- **Days the bill hasn't reached yet are marked "estimated."** Gateway
  rows arrive instantly; the bill lands days later. Until a provider/day
  has a bill row, the screen shows the gateway number with an
  *estimated* tag; when the bill lands, the number flips to the bill and
  the tag disappears. Computed at read (does the bill row exist yet?),
  nothing stored — the same pattern AWS, Azure and GCP cost pages use,
  so Tuesday's $4.20 becoming Thursday's $6.00 never looks like a
  silent change.

Where no bill covers the traffic, gateway rows stand alone, labeled
*metered*. The overlap rule runs at **query time, never insert time**:
gateway rows arrive instantly, bills days later, and Anthropic restates 30
days back (#6978) — only a read-time rule survives a restated bill.

**Bill composition — what "the bill" actually contains.** A provider's
cost feed is not the invoice. Azure Cost Management amounts are
**pre-tax** and, unfiltered, mix usage, purchases and refunds — a
refund day can make a daily amount **negative**. Negative days are
legal in storage (Int64) and on screen, and are never clamped to zero:
clamping silently eats money. Whether OpenAI's cost endpoint nets out
granted credits is **unverified** — a §20 probe before the
reconciliation claim is made for OpenAI. "The bill is the total"
therefore means: the screen reconciles to the provider's **pre-tax
cost-feed subtotal**, not to the tax-inclusive invoice line.
Separately, gateway metering prices at **list rates** while bills
reflect contracted and discounted rates (batch, cached tokens,
negotiated pricing): for a discounted account, a persistent "metering
ran over bill" variance is the **expected signature of the discount**,
not pipeline drift — the variance line labels it as such, so the
screen doesn't train users to distrust a healthy pipeline.

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

Interop note (checked against the FinOps FOCUS standard, v1.x): the
model exports cleanly if ever needed — `AmountNanoMinor` →
`BilledCost`, `CurrencyCode` → `BillingCurrency`, `Day` →
`ChargePeriodStart/End`, `Provider` → `ProviderName`; actor, model and
our metered amounts as custom `x_` columns. Our metered amount is
**never** exported as FOCUS's `EffectiveCost` — that column means
amortized *billed* money, and ours is a list-rate estimate.

### §4. One daily rollup, filled by a fold projection, read through a thin service

The screen never talks to providers and never merges numbers itself:

```text
event_log ── gateway-spend events ──┬─(existing projections)──► gateway_spend / budget ledger  (sibling tables)
          └─ pulled-usage events  ──┴─(rollup fold projection)──► governance_cost_rollup_1d ──► thin cost service ──► screen
                                                                                  ▲
                                                             Postgres (names, price list) ┘
```

The rollup projection consumes the **events** (gateway-spend and
pulled-usage events on the log) — the `gateway_spend` table and the
budget ledger are *sibling projection outputs* of those same streams,
not the rollup's inputs. Projections register per-pipeline, so this is
two registrations (one on each money pipeline) writing one table; replay
means replaying both aggregates from the log.

- **`governance_cost_rollup_1d`** — one row per tenant × day × ingestion
  source × cost_source × provider × model × agent × currency ×
  raw-actor-id (see Schema). **Every one of those dimensions is in the
  table's dedup key** — `OrganizationId` is deliberately payload rather
  than a dimension, because `TenantId` already addresses the row
  (Schema) — in a ReplacingMergeTree the ORDER BY tuple *is*
  the row's identity, and a dimension left out of it is not "stored for
  drill-down", it is silently collapsed on merge (this codebase already
  shipped that bug once: migration 00069's comment documents two budgets
  sharing a scope collapsing into one aggregate). Filled by a **fold
  projection** (our own app code on the event stream, ADR-015), **not** a
  ClickHouse materialized view: a rebuild is a replay, and a correction
  event *updates* the affected old day instead of adding to it — the
  known MV failure mode on corrected rows (and the reason ADR-034 already
  made this exact choice for trace analytics).
- **A pull that changes nothing still appends an event.** Re-reading a
  day and finding the same figure is not a no-op to be optimized away: it
  is the observation that says the provider has stopped moving that day,
  and it is the only thing that advances `LastObservedAt` and lets §15
  ever call a day settled. The event carries the pull's observation
  timestamp, so the fold takes that value off the event rather than off
  the clock and a replay lands on the same number (Invariants,
  "Rebuild = replay"). Suppressing confirming events would leave the
  provisional marker anchored on the last *change*, which is the calendar
  bug §15 already rejected wearing a different hat.
- **All columns on day one, wave-2 ones included** (raw actor id,
  department at time of spend). Summed rows cannot grow dimensions later.
- **Thin service in front**: computes seat money at read (§6), attaches
  names from Postgres at read (app-layer join — the codebase's standard),
  serves per-*request* drill-down from the raw tables (`gateway_spend`,
  ledger) — per-*person* aggregates come from the rollup itself, since
  raw-actor-id is a rollup dimension — joins puller health (§4a) so a
  missing day renders as "no data", and enforces §18's permissions.
- **Every read of this table must be dedup-safe** (`argMax` by
  `EventTimestamp` — the ReplacingMergeTree's replacement version — or
  the IN-tuple pattern, ADR-015:98). The shipped table's column named
  `Version` is *not* that: it is the fold's schema-snapshot stamp
  (Schema), and taking `argMax` over it would dedup on the wrong axis
  entirely. ReplacingMergeTree dedups
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
pattern; fine per-tenant at today's volume — the pre-ADR research
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
  [last successful pull]" — distinct from a genuine $0 day.
  **Unhealthy = 3 consecutive failed runs** (ruled by Sergio
  2026-08-29); a single flake never flips status, a third strike always
  does. Prerequisite named in §20, and it is *two* fixes, not one: the
  puller worker today never flips source status on repeated failure
  (`pullerWorker.ts` `assertRunMadeProgress` raises and stops), the
  model's error counter has **no production writer**, and no
  last-successful-pull timestamp exists at all (`lastEventAt` records
  any event's time, not pull success) — the render needs a **new
  field** plus the status flip.

The variance line (§2) already gives bill-vs-metering drift a first-class
UI; these three give the pipeline itself the same honesty.

**Alerts are automations, and automations are out of wave 1.** Wave 1
surfaces every signal on screen (variance line, projection lag, source
health); it sends nothing. All three signals live in queryable
tables/columns, so a future automations layer can attach notifications
without this design changing — the signals are the API, the alerting is
a consumer.

### §5. One `cost_source` column carries channel and provider

Values: `gateway` and `pulled` — the two lanes wave 1 ships
(`GOVERNANCE_COST_SOURCE`). Which provider a pulled row came from is the
`Provider` column, not a suffix on this one. Filtering this column is how
"show separately" and "show combined" are the same table. A new value is
added when a lane actually ships, never reserved ahead of one.

- **`seat` is never a value** — seat money is computed at read, never
  stored as rows (§6).
- **`trace` is not a value** — trace cost stays a separate system
  (per-request `Float64` in `trace_summaries`), and no pipeline carrying
  trace cost registers this fold, so no row can carry a trace source. If
  the trace lane ever merges in, that is a new value added with it, after
  the exclusion filter (§7) exists.

### §6. Seat counts are durable events; seat money never is

Each day the roster puller writes an event: *"provider reported N seats of
type X."* Money is the multiplication, done at read: count-event × dated
price list (which **we maintain** — no API publishes seat prices, proven
for Copilot). The price list follows the llmcost pattern already in the
repo — a JSON source of truth loaded into a registry, org-level
overrides on top (`modelProviders/llmModels.json` →
`loadModelCatalog.ts` → `registry.ts`, overrides via the existing
drawer/router shape): manually seeded now, an automated sync task later
(ruled by Sergio 2026-08-29). A wrong price never poisons storage; fix the list and every
screen heals, because the stored event only ever claimed a count, which
stays true. Roster history is frozen: January's count lives in January's
events after people leave in March.

If a roster-reported license type has **no matching price row**, the
screen shows "N seats — price missing", never a silent zero: the count
must not drop out of the sum through an inner join. (The failure
red-team caught this as an unstated behaviour.)

Rejects: storing seat dollars (bakes price-list mistakes into history);
pure compute-at-read with no events (loses roster history — the count on
a past date becomes unknowable).

### §7. Every dollar has one home; the exclusion filter and key-to-bill mapping ship in wave 2

Gateway, provider-bill, and seat channels are separately labeled and never
double-count. **In wave 1 this invariant is structural**: the lanes are
never summed into one figure (§1), so there is nothing to exclude and
the rollup projection is **not blocked** on any filter — the evidence
pack ranked the missing filter as risk #1 *for a combined view*, and
wave 1 doesn't build one. (Deferral ruled by Sergio 2026-08-29; it
removes the filter from the wave-1 critical path.)

**Wave 2 — coverage is an explicit admin mapping, not an assumption.**
When an admin connects a provider bill (an `IngestionSource`), they say
which gateway keys that bill pays for. **The mapping is a dated join
table** (`IngestionSourceKeyCoverage`, Schema) — the schema addition that
is the reason this waits for wave 2. Dated, because coverage is read at
query time: re-pointing a key from Bill 1 to Bill 2 in June must leave May
filed under Bill 1, and an un-dated column would silently re-file every
past month the next time a chart is drawn — history edited by a
present-tense edit, which hard constraint 2 forbids. A separate table,
because one-home then becomes a **database** guarantee: an exclusion
constraint refuses a second bill claiming an already-covered key, rather
than letting the last admin to hit Save win. The rule then reads:

- A gateway row whose key is **mapped** to a source: the bill replaces
  its number in the combined total; the row still splits the bill (§2).
- A gateway row whose key is **unmapped**: it stands alone as *metered*
  — its dollars are real and no bill claims them.
- Mapped keys' gateway sum **exceeding** the bill is §2's variance line:
  total stays the bill, the overrun is shown, never subtracted.
- **Cross-currency guard (§3):** the split/variance arithmetic requires
  the bill and its mapped gateway rows to share a currency code. When
  they differ (e.g. bill in EUR, gateway metering in USD) and no
  biller-provided USD conversion exists, the mapping is **ineligible** —
  both lanes render separately, each in its own currency, until a biller
  conversion or a dated rate table (§3 b) is available. Where a biller
  conversion *does* exist the split uses the converted amount and the
  variance is computed in that currency; the original invoice currency
  is still shown alongside.

  "No conversion held" is **NULL, never 0**. The USD column is
  `Nullable(Int64)` defaulting to NULL (migration 00087), because zero is
  a legal cost — free-tier and zero-rated rows really do cost nothing —
  so a 0 sentinel cannot tell "we hold no USD figure" apart from "this
  cost nothing", and a reader charting it would draw the unpriced rows as
  real zero-cost usage. Eligibility is therefore decided by
  `countIf(isNull(AmountNanoUsd)) = 0` over the mapped rows, not by
  comparing against 0. Sums stay honest without any guard clause: SQL
  aggregates skip NULL, so an unpriced row is absent from the total
  rather than dragging it toward zero, and the same count is what tells
  the screen to render "—" instead of a figure.

**Re-pointing is one transaction, and a gap is unrepresentable.** The
guarantee the database gives here is non-overlap, and a non-overlap
constraint structurally cannot see a *gap*: two admins editing through
independent updates can close the open row for a key and open its
successor an hour later, leaving an hour of that key's spend covered by
no bill at all, with nothing raised and nothing to find it later. So
re-pointing is never two writes. It is one transaction that takes
`SELECT … FOR UPDATE` on the key's open coverage row, closes it, and
opens the successor with the same instant as its `validFrom` — the two
rows are written together or neither is. Continuity is the transaction's
job; the constraints below cover only the errors a correct transaction
can still make. (Proved on live Postgres 16.14 in the 2026-09-02
red-team panel: the two-admin interleave left usage at 11:00 with zero
covering bills and raised nothing.)

Three constraint rules follow from that:

- **No partial unique index.** The exclusion constraint alone already
  rejects a second open row for a key (SQLSTATE 23P01). Adding
  `UNIQUE ("virtualKeyId") WHERE "validTo" IS NULL` on top is strictly
  redundant, and it makes the *common* race surface as 23505 instead of
  23P01 — two error codes for one rule, and the application would have to
  handle both to say one sentence. Exclusion constraint only.
- **`CHECK ("validTo" IS NULL OR "validTo" > "validFrom")`.** A zero-width
  row (`validFrom == validTo`) forms an empty range, which overlaps
  nothing — not even itself — so it slips past the exclusion constraint
  entirely and files a bill against no time at all. An inverted row
  (`validFrom > validTo`) raises a raw type error (SQLSTATE 22000) that
  no layer maps. The `CHECK` rejects both, in the database, with one
  named condition.
- **SQLSTATE 23P01 is mapped to a named domain error**, with copy the
  admin can act on ("another bill already covers this key"). Today the
  repo maps only Prisma's `P2002` (unique violation) and handles no
  exclusion violation anywhere, so without this the losing side of a
  legitimate race gets a generic unknown error and a trace id.

**Cross-org rows and dangling open rows need a trigger.** `relationMode
= "prisma"` means these are not real foreign keys, so nothing in the
database stops a coverage row from naming one organization while its
virtual key belongs to another, and nothing removes an open row when the
key it points at goes away — the orphan then occupies the key's one open
slot forever. A trigger (or an equivalent check on the write path, if
the trigger proves impractical in the migration) ties the coverage row's
`organizationId` to the key's `organizationId` at write time.

**A re-point takes effect at the next UTC midnight.** The rollup buckets
spend with `toStartOfDay`, so a day is the finest thing a bill can own; a
mid-day effective instant is not representable and a noon re-point would
file the whole day under whichever bill the read happened to resolve.
Making midnight the only legal effective time is what keeps "May stays
under Bill 1" true on the one day people actually check it. Admin UI
therefore offers a date, not a timestamp.

**Deployment: `btree_gist` is the repo's first extension.** No
`CREATE EXTENSION` exists in the 297 migrations shipped so far. The
migration must check the extension is available and fail with an
actionable message rather than half-applying; the self-host
documentation and the Helm chart must state the requirement; and
availability must be verified per managed-Postgres provider before the
migration ships (Azure Database for PostgreSQL in particular is
unverified). This applies equally to `IdentityMatch` and `SeatPrice`,
which use the same guard.

The mapping is edited beside the source config (small admin list,
audited, read at query time like every overlap rule). The exclusion filter
stays a **blocking prerequisite of the wave-2 combined view** — the first
screen that merges lanes cannot ship before it. Rejected: a list column of
key ids on `IngestionSource` — un-dated, rewritten wholesale on every
edit, and with no way for the database itself to hold the one-home rule.
Rejected: provider-wide
coverage — one connected bill silently claiming *all* that provider's
gateway traffic. Zero-config, and correct for a single-account org, but
an org with a second, unconnected account of the same provider would
have that account's gateway dollars silently swallowed by the wrong
bill; the explicit mapping keeps them visible as metered. (Ruled by
Sergio 2026-08-29.)

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

**Erasure is keyed on `DiscoveredPerson`, not on the platform user.**
The unit of erasure is the discovered-person record, and the erase
action on that record is what drives every step below. This is not a
detail of plumbing: most `DiscoveredPerson` rows name people who have no
LangWatch login at all — contractors, seat holders who never signed in,
anyone whose email a provider put on a cost row — so there is no
`userId` to key on, and a user-deletion event can never fire for them.
Keying on the platform user would have silently scoped "every erasure
path" to the minority of discovered people who happen to also be
customers of ours. (Ruled 2026-09-02 after the red-team panel; the
earlier v3.3 design drove erasure from the `lw.identity.user_erased`
event, which is now the optional supplementary trigger described in
§11.)

When a provider-supplied raw actor id contains personal data (e.g. an
email address), GDPR erasure:

1. **records the erased identifiers on a suppression list** — a hash of
   each identifier the erasure covers, scoped to the organization *and
   the provider* (`ErasedIdentifierSuppression`, Schema), so erasing an
   address a customer holds at one provider does not silently suppress
   the same string arriving from another. Without this the erasure is
   undone by the pipeline that produced it: the pullers look 30 days
   back, so the next day's pull re-ingests the same email and re-writes
   what we erased. The list stores hashes, never the identifier, so it
   is not itself a copy of the data it exists to keep out. The stored
   `identifierHash` and the pseudonym written in step 5 are **the same
   function of the same input** — `SHA-256(secret ‖ original)` — so a
   write path computes that digest once and uses it twice: as the
   membership test against this list, and, on a hit, as the value it
   writes in place of the original.

   **The check gates every write path that carries the identifier, not
   just the identity tables.** Suppressing only `DiscoveredPerson`
   creates and updates would leave the erased email flowing back in
   through the paths that never touch that table:

   - `DiscoveredPerson` creates and updates, and the `DiscoveredAgent` /
     `IdentityMatch` writes that hang off them;
   - **writes into `governance_ocsf_events`**, including the structured
     `ActorEmail` column and the raw OCSF payload — a suppressed
     identifier is dropped from the event rather than written and
     erased again later;
   - **seat-pull row writes** (§16), which carry `displayName`,
     `userPrincipalName` and `mail` and would otherwise re-materialize an
     erased person on the very next roster pull.

   One check, consulted at each of those write points, is what makes the
   erasure hold against a pipeline whose whole job is to re-fetch the
   same 30 days tomorrow.
2. blanks `IdentityMatch.userId` (§11) where a platform user was linked,
3. pseudonymizes `rawActorId` and `displayText` on the `DiscoveredPerson`
   row (hash-replace, preserving the row for spend attribution),
4. rewrites the rollup rows carrying that id so they carry the pseudonym
   instead. **Not with an `ALTER TABLE … UPDATE`:** `RawActorId` is in
   the ORDER BY, and ClickHouse refuses a mutation on a sorting-key
   column — the key *is* the row's identity, so a changed key is a
   different row rather than an edited one, and the engine will not
   pretend otherwise. Erasure goes through the rebuild path the rollup
   already has (§4: "a rebuild is a replay"): record the identifier on
   the suppression list (step 1), `ALTER TABLE … DELETE` the rows
   carrying the original value, then replay the affected days, which
   re-derives them with the pseudonym in place of the original. **The
   delete is scoped by `TenantId`, not by `OrganizationId`** — the same
   predicate §11 lands on, `TenantId IN` every tenant this organization
   has ever written under per `GovernanceTenantHistory`, and for the same
   reason: `OrganizationId` is payload carrying a `DEFAULT ''`, so a
   predicate on it misses any row
   written before the column was populated and leaves the erased
   identifier sitting in the table. `TenantId` leads the ORDER BY and is
   never empty, and the history table is what makes the scope survive an
   org that has been renamed or re-tenanted. The pseudonym is deterministic (e.g.
   `SHA-256(secret ‖ original)`) so every replay lands on one stable key
   rather than minting a new one per run.

   Bounded by the replay horizon, and honestly: for days older than
   `event_log` retention there is nothing left to replay from, so the
   delete is the whole operation and that actor's spend on those days
   leaves the rollup rather than reappearing pseudonymized. Totals for
   those days drop by the erased amount. The alternative — leaving the
   row and its personal data in place — is not one, so the erasure job
   records which days it could not rebuild instead of failing silently.
5. **Replay safety, with no stored mapping from pseudonym back to the
   original.** The fold / replay pipeline (§4) must pseudonymize an
   erased `RawActorId` *before* writing the rollup row. Without that, a
   replay re-derives the original value from the raw event log and
   inserts it beside the pseudonymized row, duplicating the amount.

   It does **not** need a table of original-to-pseudonym pairs to do it,
   and must not have one: such a table would keep the erased identifier
   in plaintext forever, which is the opposite of what the erasure was
   for, and would contradict step 1's whole point that we store hashes
   and not identifiers. The fold already holds the original value in
   hand — it just read it off the raw event — so the two things it
   needs are a **membership test** and a **recomputation**: hash the
   value it is about to write, test that hash against
   `ErasedIdentifierSuppression` for this `(organizationId, provider)`,
   and on a hit write that same digest in place of the original — the
   suppression list's `identifierHash` and the pseudonym are one
   `SHA-256(secret ‖ original)`, computed once per write and used for
   both the lookup and the replacement (step 1). Because the
   pseudonym is deterministic in the original, every replay of every day
   lands on the same key without anything ever having been stored.
   `ErasedIdentifierSuppression` is therefore the only table erasure
   adds. Scoping the lookup by `organizationId` and `provider` matters
   for the same reason it does on the suppression list: the same raw
   actor id string can be a different person under a different provider
   or tenant.

   Tests, against the ClickHouse version we deploy rather than a mock:
   erase, replay, assert the rollup contains only the pseudonymized key
   with the correct total; a replay-twice test asserting the pseudonym
   is byte-identical across runs; a collision test with the same
   original value under two providers, where only the erased side is
   pseudonymized; and one that asserts the mutation route is closed — an
   `ALTER TABLE … UPDATE` on `RawActorId` must be rejected, so nobody
   re-adds the step that cannot work.

Retention policy (§7) covers event expiry; the identity tables carry
their own `validTo` lifecycle. Provider-opaque identifiers (UUIDs,
numeric ids) are not personal data in isolation but **are** personal data
when stored alongside identity context — evaluate per provider whether
the identifier is reversible to a person outside our system before
exempting it from erasure.

### §10. Five actor kinds, all first-class: people, agents, API keys, seats, service accounts

- **Service accounts** (machine logins — Databricks service principals
  and kin) are their own kind, detected **deterministically**: in
  Databricks query history humans surface as emails and service
  principals as bare UUIDs (proven under app-only auth,
  `51_by_user.csv`). A UUID in `executed_by` is a service account,
  never lumped into "agent" — agent-adoption numbers must not include
  plumbing. Honesty note: our own measured "68% of statements by
  service principal" (301/443, `51_by_user.csv`) is an ingestion
  artifact — our own tooling (undici/curl/urllib/node) accounts for
  269 of the 436 grouped rows in `20b_query_history_by_app.csv`; the
  ADR ships the mechanism, not that number.
- **Agents** are first-class discovered records (Genie space, Copilot
  bot, OpenAI project) with cost attached where the provider allows
  (OpenAI per project ✓; Genie via warehouse proration only — serving
  tokens provably untieable; Copilot money stops at billing-plan grain).
  Agent-level **activity** works everywhere; the column says which it is
  showing. Discovering an agent grants nothing.

### §11. The identity wave stands on six Postgres tables, defined here

Defined fresh in this document (the closed branch is design debris, mined
for nothing), argued from scripts and scenarios. Three carry the identity
model itself:

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

Three more support them, each argued where it is decided rather than
here: **`GovernanceTenantHistory`** (every `TenantId` the org has written
governance rows under — below in this section),
**`ErasedIdentifierSuppression`** (hashes of erased identifiers, gating
every write path that carries one — §9 step 1), and
**`IdentityMatchSuggestion`** (background-computed match candidates —
§12). All six are defined in the Schema block, alongside the two the cost
wave adds (`SeatPrice`, §6; `IngestionSourceKeyCoverage`, §7).

Postgres because the volume is small (hundreds–thousands of rows),
relational (uniqueness on provider + raw id, foreign keys to
Organization), and served to admin screens via Prisma like every other
app table. ClickHouse rows stay pure (raw ids only) and join at read in
the app layer — the pattern the whole codebase uses. Rejects: ClickHouse
residence (admin-curated rows are what it is worst at); a Postgres → CH
sync (infrastructure for a problem app-layer joins don't have yet).

**All six are keyed by `organizationId`, never by the hidden governance
project.** The rollup's `TenantId` is that project's id (§8), and unlike the
organization it is not durable: `resolveGovProjectId` resolves only
un-archived projects (`archivedAt: null`,
`ee/governance/services/govProject.ts`), and the re-mint path in
`governanceProject.service.ts` can hand back an archived row — so one
archive/re-mint cycle would orphan every identity and erasure row keyed to
it, and a delete job walking that key could miss an erased person's rows
entirely. That is the one failure this design cannot have. The organization
id outlives all of it. Rejects: keying identity and erasure on the hidden
project id (cheaper join, at the price of rows that can be orphaned by an
operation nobody connects to governance).

**Org → `TenantId` is a persisted history, not a live lookup.** Keying on
the organization is only half the fix; the other half is how the org is
translated back to the ClickHouse tenant at read and at erasure. A live
`resolveGovProjectId` call is not that translation, because it filters
`archivedAt: null` and therefore returns *null forever* once someone
archives the governance project — while the write path re-reads the same
project by slug with no such filter and keeps landing rows under the old
`TenantId`. The org would map to zero tenants on read and one on write:
a permanent split-brain in which the cost screen reports "no governance
data" and a ClickHouse erasure job erases nothing and reports success,
indistinguishable from an org that never ingested anything.

So the design persists a small table recording **every `TenantId` the
organization has ever written governance rows under**
(`GovernanceTenantHistory`, Schema), appended the first time a tenant is
used and never pruned. Reads resolve against the whole history (the
current tenant for new rows, all of them for totals); erasure walks all
of them, because personal data does not stop existing in a tenant that
stopped being current. The live resolver stays what it is — the way to
find *today's* write target — and stops being load-bearing for anything
historical.

**Guard rails so the governance project stays out of generic routes.**
The hiding invariant is enforced today only on the list surface, which is
why archiving it is reachable at all: `PATCH /api/projects/:id` and the
project service's archive/update paths guard personal projects but never
filter on `kind`, and the repository layer does not either. Wave 2 adds a
`kind` guard to the project archive and update service paths and to
GET-by-id, so a `kind = internal_governance` project is refused by the
generic project routes the way it is already excluded from the generic
project lists. This does not replace the history table — it reduces how
often the history is the only thing standing between an admin click and
an unreadable governance tenant.

**A user-erased event can trigger the flow; it can never drive it.**
Erasure is keyed on `DiscoveredPerson` (§9), and the identity pipeline's
`lw.identity.user_erased` event is an **optional supplementary trigger**
on top of that — a convenience for the subset of discovered people who
are also platform users, so that deleting such a user can kick off the
governance flow without an operator remembering to. Three limits keep it
supplementary rather than primary, and all three are structural:

- It can only ever fire for discovered people who are also platform
  users. Most are not (§9), so the majority of governance PII is outside
  its reach by construction.
- It fires for nobody today: emission is gated on the identity migration
  latch, and that gate ships closed fleet-wide, so deleting a user right
  now produces zero events. A design that depended on it would be a
  design that erased nothing and looked finished.
- Its payload carries no identifier *values* — the fold has already
  nulled them by the time the event exists — so a subscriber cannot
  learn which email to pseudonymize. It can name a user; it cannot
  perform §9's steps 1, 3 or 4.

There is a fourth reason not to depend on it, which is why it is a
trigger and not a queue: subscriber dispatch in the event-sourcing router
is caught-and-logged with no retry, and subscribers are unreachable from
replay by construction, so an erasure event missed while the subscriber
was down is missed permanently. A missed *trigger* costs a manual erase
action; a missed *driver* would cost the erasure itself. Rejects (v3.3's
position): driving erasure from the listener, on the reasoning that
subscribing covers every erasure path automatically — it covers no path
at all today, and only ever a minority of the population.

### §12. Proof connects itself; guesses wait for a human; conflicts always stop the machine

The match policy for `IdentityMatch`:

- **Deterministic evidence links automatically**, recording which
  evidence and when: **exact verified-email equality is the primary
  key** (the research's own 2026-08-20 correction), with exact
  directory-id equality (SCIM `externalId` = provider id) as
  corroboration where present — `externalId` exists only for
  IdP-provisioned users, refreshes daily, and Databricks advises
  against building on it, so it strengthens a match but never stands
  alone. (The "11/13 matched via externalId" figure survives in prose
  notes only; no script artifact backs it.)
- **Anything weaker only suggests** — "m.silva" resembling "Maria Silva"
  creates a suggestion an admin confirms. Nothing ever merges two people
  automatically. **Suggestions are computed in a background job and
  stored** (`IdentityMatchSuggestion`, Schema); the review screen reads
  stored rows and never scores anything itself. Confirming one writes an
  `IdentityMatch` row and closes the suggestion.

  This reverses v3.3's compute-at-read ruling, on measurement. Fuzzy
  matching is quadratic and there is no database route to it — the repo
  has no `pg_trgm` (no extension exists in 297 migrations) and no
  edit-distance library in its dependencies, so the scoring would run in
  our own Node process. At the volume this ADR itself uses as its
  example, 2,000 discovered people × 500 platform users is 1,000,000
  pairs, and plain Levenshtein over that set measured **2.9 seconds of
  blocked event loop** — per page load, uncached, stalling every other
  request on the instance. The resolve-at-read argument is right about
  *facts* (§9's people and departments are cheap lookups); it does not
  survive contact with a scoring pass. A second reason: without stored
  rows there is no pending-count badge, because counting the maybes
  costs the same full sweep as showing them, on every navigation render.

  **The approach, named:** a prefilter narrows the candidate pairs
  before any edit distance is computed — a length band plus a
  shared-token requirement — and only surviving pairs are scored. The
  job runs when its inputs change (new or updated discovered people, org
  membership changes), never per page view. Suggestion rows are
  invalidated and recomputed by the same job, so the lifecycle v3.3
  wanted to avoid is a job's, not a screen's.

  Accepted cost: a suggestion can be a few minutes stale after a
  discovery, and dismissals are now storable but stay out of v1 (a maybe
  an admin ignores still comes back), so dismiss-fatigue is unresolved
  either way.
- **Conflict rule (the two-m.silvas safeguard):** if evidence points at
  two candidates, or new evidence contradicts an existing link (a
  provider id already linked to someone else), automatic linking
  **suspends for that identity** and flags a human. Directory ids cannot
  collide (unique by construction); the risk lives in email evidence —
  shared mailboxes, and addresses re-issued to new hires. Re-issued
  emails are survivable *because links are dated*: the leaver's link
  closes at offboarding, the new hire gets a new link, and January's
  spend stays with January's person. **The suspension itself is stored**,
  and on the discovered person rather than in the suggestion job's
  output, because a halt on automatic linking is worthless if a restart
  or a recompute clears it (`DiscoveredPerson.suspendedAt` /
  `suspendedReason`, Schema). Unchanged from v3.3.
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
  *hints* (`claude_code_key_<team>_*` is signal), never as attribution.
- **OpenAI**: the label is **"attributed to", never "spent by"**, and
  spend is never resolved through the key roster — 53% of measured spend
  sits on deleted keys. The `user_id`/`user_email` on the cost row itself
  is carried per §9.
- **Copilot**: three sources on one screen — seat cost (our price list ×
  roster), real daily spend (Azure Cost Management, for pay-as-you-go
  customers who grant the role on a **separate billing identity**, §21),
  activity (conversation counts). Prepaid customers see an honest
  "prepaid credits are not readable through the cost feed" note —
  shown only where the customer has **declared** they are prepaid
  (§21.4). We never infer it: an empty cost feed is indistinguishable
  from a quiet month, and a guessed sentence about someone's contract
  is a confident falsehood.
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
needed. If ever exported, corrections materialize as *new rows*
synthesized from the event log (the FOCUS `ChargeClass="Correction"`
shape), never as mutated rows. Rejects: silent recompute
(unreconcilable exports); freeze-after-N-days (our screen would
knowingly disagree with the provider's own console).

**Provisional is a second marker, and it is orthogonal to the first.** A
figure whose day still sits inside the provider's settling window renders
as **provisional** — "this can still move" — while *revised* says a
restatement already happened. The two are not opposites and do not
compete: "already moved" and "can still move" are independent facts
about a day, and a day can be both. No source supplies finality:
Anthropic revises cost for up to 30 days (#6978), and FOCUS's
`ChargeClass="Correction"` describes only periods that have already
closed, so nothing on the wire tells us a day is settled. The flag is
therefore **derived** from a per-source settling window
(`SETTLING_WINDOW_DAYS`, Constants — 30 days by default, overridable per
source as providers differ), computed **at read, from a stored
observation timestamp** rather than persisted as a flag — like every
other overlap rule, the answer changes with the clock, so storing it
would only mean storing something that goes stale. The reason it earns a
marker at all: a governance number that silently restates is worse than
one that admitted up front it might.

Three rules make the marker mean what it says.

- **The window is anchored on the pull, not on the calendar.** A day is
  provisional while fewer than `SETTLING_WINDOW_DAYS` have passed since
  **a pull last touched that day**, not since the day itself. Calendar
  age gets both ends wrong. On the first connect a puller backfills 90
  days, so every day older than 30 would render *settled* the instant it
  landed, having been read exactly once — the opposite of the truth. And
  a source pulled weekly keeps showing days as provisional for up to 23
  days after the provider has stopped touching them, because the clock
  ran while nothing was watching. Anchoring on the last pull that
  covered the day means the marker tracks our own observation of the
  provider, which is the only thing we can honestly claim to know. The
  test reads that anchor from **`LastObservedAt`** on the rollup row
  (Schema), which every fold write touching the day moves forward —
  including a re-pull that confirms an unchanged figure, which is
  precisely the case a correction-only timestamp would miss. The value
  is **the pull's own observation timestamp, carried on the event**, not
  the wall clock at fold time: taking the clock would mean a replay
  stamped every day as observed today, breaking the rebuild-equals-replay
  invariant, and would let §9's delete-then-replay erasure quietly flip
  long-settled days back to provisional. It is also not the shipped
  `LastEventOccurredAt`, which is the newest *provider-side* event time
  folded into the row — that one stands still exactly when a re-pull
  re-confirms old events, which is the case this marker exists to see.
- **Revised and provisional render together, because together is the
  normal case.** Anthropic restates within 30 days and the window is 30
  days, so essentially every revision we see lands on a day that is
  still inside its own window: the both-true cell is not an edge case,
  it is the common one. The cell shows both markers, in one line —
  *"revised, was $X — may still change"*. Showing only one of them would
  either hide a change that already happened or promise a finality we do
  not have.
- **Gateway rows are exempt.** Rows with `IngestionSourceId = ''` are
  metered by us in real time and are never restated by anyone; the
  per-source override cannot reach them because they have no source. Left
  in the general rule they would carry "can still move" for 30 days on
  the product's most-viewed and most-final numbers. They render with no
  provisional marker, ever.

Open, and recorded rather than assumed: **the 30-day default is measured
for Anthropic only.** Azure's and Databricks' restatement windows have
not been probed, so `SETTLING_WINDOW_DAYS` stays a provisional constant
for those sources until they are — the per-source override exists
precisely so measuring one does not require re-deciding the others.

### §16. Idle seats split across the waves (FR3)

- **Wave 1, the aggregate**: "you pay for N seats, M are assigned" per
  provider — both numbers straight from the provider's SKU/roster counts
  (bought vs assigned). No identity needed, no usage join.
- **Wave 2, the names and the activity**: an *active*-seat count (distinct
  raw actor ids on usage rows) and listing *which* seats are idle both
  require the roster ↔ usage-actor join (§11). Idle default: no activity
  for 30 days, adjustable per org; last-activity date always shown. The
  roster side of that join comes from **extending the seat pull to
  per-user assignment facts** — "the provider reported that this person
  holds a seat of type X on day D" — appended as durable events on the
  same spine as §6's counts, which today carry only a number. That
  extension is what makes a never-active seat holder visible at all: by
  definition they appear in zero usage rows, so no usage-side derivation
  can ever name them, and they are precisely the person this feature
  exists to find. Stated plainly, it widens what the pull stores to names
  and email addresses — the same class of personal data §9 already carries
  on usage rows, under the same erasure path (§9, §11). Rejects: keeping
  the pull counts-only, which would quietly demote this bullet's promise
  from *which* seats are idle to *how many*.
- FR3 is **partially** met in wave 1, met in wave 2 — the ADR says so
  rather than rounding up.

**What the seat feature must fix before it may ship, in its own PR.**
Naming seat holders puts names and email addresses into
`governance_ocsf_events`, and that table is not currently ready to hold
them. Four obligations ride inside wave 2, in the same change as the
seat feature — not as follow-ups, because a follow-up would mean
shipping the widening without the containment:

- **A fixed TTL on `governance_ocsf_events`, declared in the migration
  and deliberately outside the retention map.** The table declares no
  TTL at all, so today its rows are kept forever. It gets a **fixed
  13-month `TTL … DELETE`** written into the migration, and stays
  **absent from `RETENTION_TABLE_CATEGORY_MAP` and `TABLE_TTL_CONFIG`** —
  which is the actual precedent migration 00087 set for the rollup, for
  the same reason that applies here: the identifier is personal data, so
  its holding period must be a fixed bound rather than a customer
  setting. Enrolling the table in the retention map is ruled out, not
  merely skipped: the reconciler's `MODIFY TTL` replaces the whole TTL
  expression atomically (`ttlReconciler.ts:463`), so enrolment would
  overwrite the fixed 13-month bound with the customer's own retention
  value — and a customer who sets a longer one would then hold names and
  email addresses past 13 months. The un-TTL'd table is a pre-existing
  defect (four shipped pullers already write provider emails into it);
  the seat feature does not get to compound it.
- **Seat-assignment rows are excluded from the SIEM export.** The export
  filters on tenant and time and never on `ActionName`, so it ships
  whatever is in the table wholesale to a customer's SIEM. Seat rows are
  roster facts about employees, not security events, and they are
  excluded by action name.
- **Payload-level redaction is an open problem, and the wave-2 answer is
  delete-and-skip.** The raw OCSF JSON carries `displayName`,
  `userPrincipalName` and `mail` verbatim, and the read path returns that
  blob whole (`argMax(RawOcsfJson, …)`). Substituting a pseudonym into
  one column cannot redact a JSON document, so §9's step-3
  pseudonymization does not reach seat rows. For wave 2 the erasure path
  for seat rows is therefore **delete the rows and suppress the
  identifier** (§9 step 1). Deleting alone would not be complete — the
  next roster pull re-reads the same 30 days and re-writes
  `displayName`, `userPrincipalName`, `mail` and the structured
  `ActorEmail` column straight back in. It is the suppression check
  sitting on the OCSF and seat-pull write paths, not only on
  `DiscoveredPerson`, that makes the deletion stick. Complete, then, but
  coarse: the seat history for that person disappears rather than
  becoming anonymous. A
  payload-level redaction story — structured columns, or a redacting
  read path — is named here as owed work, not solved.
- **The puller loop needs paging.** The per-user Graph seat endpoint
  paginates; the current `subscribedSkus` pull does not, and its cursor
  design assumes an unpaged response. At 10,000 seats across 3 SKUs the
  extension is roughly 30,000 rows per day, so this is a pull-loop
  change, not a parameter change.

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
org → team → project scope tree to users or groups. Pulled-money
visibility is **org-scoped**: wave 1 grants `governance_cost:view` at
org scope (ruled by Sergio 2026-08-29). What a viewer *sees*
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
- **Three one-script probes before the relying code ships** (same rigor
  as the cents finding): (a) Azure `totalCostUSD` — documentation-only
  today, no script ever requested it; if this agreement type doesn't
  serve it, §3(a)'s biller-conversion column stays 0 and per-currency
  display still holds. (b) Whether OpenAI's cost endpoint nets out
  granted credits — decides what §2's reconciliation claim means for
  OpenAI. (c) Databricks SCIM listing under app-only service-principal
  auth — today unproven (no artifact; the probe's curl would pass a 403
  silently); also record the privilege level the Databricks puller
  actually needs (docs indicate CAN MANAGE per Genie space and
  account-admin grants for system tables — some security teams will
  refuse). Each probe's answer is **recorded in the Assumptions table**
  when it lands — the table row flips from "unprobed" to the measured
  result, so the ADR stays the single place the truth lives.
- **Audit single-copy** — the 9 adapters' direct-insert audit path
  becomes journal-backed on a separate infra track; not an ADR
  risk.
- **Puller success/failure must persist onto the source** — today
  `assertRunMadeProgress` (`pullerWorker.ts:261-289`) raises but never
  marks the `IngestionSource` unhealthy, the error counter has no
  production writer, and no last-successful-pull field exists
  (`lastEventAt` is not pull success), so a silently-failing puller is
  indistinguishable from a $0 day. The fix is a status flip on repeated
  failure **plus a new last-successful-pull timestamp**; §4a's "no data
  since [date]" render depends on both; ships with wave 1.
- The broken `openai_compliance` / `claude_compliance` sources are
  replaced/retired per ADR-122's diagnosis, outside this document.

### §20a. Pre-existing defects surfaced by review

The 2026-09-02 red-team panel found four problems that are **not** this
ADR's design and were already shipped, but that wave 2 either has to fix
or has to stop leaning on. Written down here so nobody re-discovers them
as surprises during implementation, and so the ones being fixed inside
wave 2 are visibly scoped rather than quietly absorbed.

| Defect | Status |
|---|---|
| `governance_ocsf_events` declares no TTL at all, so its rows are kept forever, while four already-shipped pullers write provider email addresses into it — and the SIEM export ships the table filtered only by tenant and time | **Fixed inside wave 2** (§16): a fixed 13-month `TTL … DELETE` declared in the migration, the table deliberately left out of the retention map (whole-clause `MODIFY TTL` would overwrite the fixed bound with a customer-settable one), seat rows excluded from the export by action name |
| The hidden governance project is reachable through the generic project routes — `PATCH /api/projects/:id` and the archive path guard personal projects but not `kind`; the hiding invariant is enforced only on the list surface | **Fixed inside wave 2** (§11): `kind` guard on archive, update and GET-by-id, on top of the `GovernanceTenantHistory` table that makes an archive survivable rather than fatal |
| The `event_log` plaintext erasure service designed in ADR-101 §5 was never written, so pre-erasure identifier values remain in the log (already documented in ADR-127) | Tracked separately; §9's erasure is complete for the rollup and the identity tables and does not claim to reach the event log |
| The identity migration latch ships closed fleet-wide, so `lw.identity.user_erased` currently fires for no one | Tracked separately; §11 demotes that event to an optional trigger precisely so this does not block or fake governance erasure |

### §21. Azure billing is a second identity on the same connection, and a bill we could not read is never rendered as zero

Wave 1 shipped the Azure cost read using the **same registered app** as
the Copilot bot (`copilotStudioDataverse.puller.ts:398-405` builds both
the Dataverse token and the Resource Manager token from one flat
credential set). That works and is wrong: it makes the money permission
and the employee-content permission the same grant. §20 already wrote
down that "some security teams will refuse" a broad grant, for
Databricks; this is the same objection, for Azure, and it is the one an
enterprise security review actually raises.

**21.1 Two identities, one connection.** The Copilot Studio source
carries two registered apps: the **bot identity** (Dataverse
transcripts, Graph seat counts) and a **billing identity** (Azure
Resource Manager, holding **Cost Management Reader** at the
subscription). They are separate credential keys in the same connection,
not separate connection types.

*Why.* Separation of duty is a property of which login holds which
permission, not of how many things a customer has to connect. Azure
reports spend **per subscription**, and every environment in a Copilot
deployment bills to one subscription — so a second connection type would
stand in exactly one relationship to the first, forever, while doubling
what a customer has to get right. The security goal is met entirely by
the credential split: the approver who signs off on the finance grant
hands out a permission that reads money and cannot read a conversation.

*Rejects:* a dedicated billing connection type (§21 rejected
alternatives); and **any fallback to the bot identity** when billing
credentials are absent. A fallback silently re-creates the exact grant
this section exists to break, and it does so in the one case nobody is
watching — the customer who declined to give billing access.

*Form default (v3.7).* The create form defaults to **one app
registration for both reads**: the switch "Use one app registration for
everything" starts on, and the builder copies the bot pair into the
billing keys at save time. This is not a fallback — the billing keys are
always present when a subscription is claimed, written deliberately, and
the token paths stay separate. The split arrangement remains the
*recommendation* for tenants whose finance approval is separate, one
flip away; the guard never required the pairs to differ, so the default
codifies what most admins were going to do anyway rather than weakening
an enforced boundary. The choice is recorded as
`azureBillingUsesSameApp` (a non-secret config key), because once the
credentials are sealed, equal pairs cannot be told apart from a
deliberate second app with equal values. Spec:
`specs/governance/copilot-studio-form-controls.feature`.

**21.2 No schema change, and no new secret-handling path.** Credentials
are already `Record<string, string>`
(`pullers/pullerAdapter.ts:164-168`), decrypted by the worker before an
adapter sees them, and carried across edits without ever being returned
to the browser (`activity-monitor/ingestionSource.service.ts:771-791`).
The billing identity is two more keys in that map. *Why:* the encryption,
carry-across and never-echo guarantees are the expensive parts and they
already exist and are pinned by test
(`dashboard/pages/__tests__/ingestionSourceSecretFields.unit.test.ts`);
adding a second secret storage shape would mean auditing two of them.

**Inside the envelope is load-bearing, not stylistic** (red-team, v3.4):
both never-echo guards match the key `"credentials"` by exact string
equality (`routers/ingestionSources.ts:104`,
`activity-monitor/ingestionSource.service.ts:791`). A billing secret at
any *new* top-level key — `billingCredentials`, say — would be returned
to the browser and dropped on edit. The new keys go inside the existing
`credentials` map or nowhere.

**21.3 The spend lane never displays a figure it did not read.** Where
there is no figure, the lane carries a **reason from a closed list**
(Constants) and the screen turns that reason into a sentence. A blank is
never rendered as `0`, and a currency amount is only ever drawn from a
read that returned one.

The reason channel is **new construction, not a port** (corrected by the
red-team, v3.4): `GovernanceCostLaneDto` today has no status field at
all, `unavailableReason` is a two-value whole-screen switch, and the
puller collapses every cost failure — 403, 429, timeout, malformed
reply — into one bare `return null`
(`copilotStudioDataverse.puller.ts:1128`) whose reason survives only in
a log line. The closed list is therefore bounded by what the system can
actually know: whether billing credentials are configured, whether the
customer declared prepaid, and whether the last read succeeded. It
**cannot** distinguish "permission refused" from "throttled" today,
because Azure's 403 and 429 die at the same line; the list carries one
`billing_read_failed` reason for both until a reason survives the
puller, which is its own change with its own tests.

*Why.* This is the whole point of the work. A finance lead who reports
"$0 Copilot spend" to a board because the panel was blank has been
misled by us, and the number is wrong in the direction that looks
reassuring. Wrong beats incomplete only when the reader can tell which
they are looking at.

*Rejects:* passing the provider's own error text to the browser —
untranslatable, changes without notice, and can carry identifiers we do
not want rendered in a customer's page. Also rejects claiming a
granularity of reason the pipeline does not preserve — a panel that says
"permission refused" on a throttle is the same confident falsehood as
the silent zero, wearing more words.

**21.4 Prepaid is declared by the customer, never inferred.** The
connection form carries a customer-set flag: *this Copilot runs on
prepaid message packs*. The prepaid sentence is shown only when it is
set.

*Why.* Prepaid credit packs create no Azure resource, so the cost feed
returns nothing — which is byte-for-byte what a quiet pay-as-you-go
month returns. Nothing in the response distinguishes them (measured,
Context §"Measured provider behaviour"). Inferring would print a
confident claim about a customer's contract that we cannot support, and
would print it most often for the customer who simply had a quiet month.

*Rejects:* inferring prepaid from persistently-zero spend alongside
present seats.

**21.5 A billing failure never changes connection health.** The source
stays **active** while conversations flow. The billing problem is
reported on the spend lane only.

*Why.* The connection's job is arriving data, and it is doing it. Red
sends whoever investigates hunting a bot fault that does not exist,
while the actionable message — *we cannot see your bill* — is on the
panel of the person who went looking for spend. The research note
reached this independently for the rate-limit case: a refusal "should
never be the reason a collection run is reported as broken"
(`configuration.md`). Azure's cost allowance is a few requests per
minute, **shared with the customer's own staff browsing cost in the
portal**, so refusals are ordinary operation, not incident.

*Rejects:* red on any billing failure; and an amber third health state,
which would be a new state across every connection type, not just this
one.

**21.6 Withdrawn (v3.4).** This section proposed a save-time
verification read — four attempts over three minutes — so a
just-granted permission would read "checking" instead of "refused"
while Microsoft's grant propagates. The red-team killed it on three
grounds and no rewrite survives them. (a) **No seam exists**: no save
path performs a cost read, and every cost read sits behind the six-hour
gate (`azureCostManagement.ts:99,118`), so the "window" would contain
exactly one attempt. (b) **The state is unknowable**: nothing stores
when a grant happened, and a hold is recorded identically for refusal,
throttle, timeout and malformed reply — a lane keyed on it would say
"checking billing access" to a customer who never granted anything.
(c) **The premise misread the measurement**: what was measured
(`configuration.md`, not in this repo) was a *subscriptions list*
returning empty after a grant — a different endpoint from the cost
query, and an empty list is not a refusal; an empty 200 on the cost
query takes the *priced* branch, not a failure branch. What survives:
the propagation delay is real and belongs in the **setup instructions**
("if the check fails right after granting, wait two minutes and retry")
— copy, not machinery.

**21.7 The lane shape is copied from seats, not factored out — and the
copy is of the shape, not the semantics.** The seat union
(`GovernanceSeatLaneDto`) is the precedent for *a discriminated union
the panel switches copy on*. It is **not** precedent for reporting a
provider refusal (corrected by the red-team, v3.4): its `read_failed`
arm fires only when **our own** ClickHouse query throws
(`governanceCost.service.ts:275-295`); a provider-side Graph 403 writes
no rows and renders as `awaiting_data` — the exact collapse §21.3
forbids for spend. Spend copies the union shape and must do better than
its semantics; the seat lane's own gap is recorded as an open question
rather than silently inherited as a standard.

*Why not factor out.* This is the **second** occurrence, not the third.
An abstraction built at n=2 is shaped like its first caller and the
next one bends to fit — §19's own reasoning, applied one level down.
Factoring out would also mean editing working seat code nobody asked us
to change, in a branch already four deep in a stack.

*Rejects:* a shared lane type spanning seats and spend now. Revisit at
the third lane.

### §22. New surfaces speak FOCUS; the shipped internal names stay

Every **new** wave-2 surface a customer can see — DTO fields, export
columns, any header on a downloadable file — uses the FinOps FOCUS
standard's name where the standard has one, and an `x_`-prefixed extension
where it does not. FOCUS through 1.4 has no columns for identity, team,
cost center, or AI/token dimensions, so most of what this ADR adds is
necessarily an extension; naming them the standard's way now means a
customer's FOCUS tooling ingests our export without a translation table,
and the ones FOCUS *does* define (§3's `BilledCost`, `BillingCurrency`,
`ChargePeriodStart/End`, `ProviderName`) already line up.
`IdentityMatch.evidenceKind` (§11) stays mappable onto the pull-mode
architecture map's `x_PersonResolutionMethod` vocabulary — the values are
chosen so the mapping is a lookup, never a re-derivation.

**The shipped rollup's internal column names do not change.** Renaming a
live table buys nothing: no customer reads a ClickHouse column name, the
export layer is where the standard is actually observed, and a rename
costs a migration plus every query that references it. The boundary is
therefore where the name becomes visible, not where the data is stored.

Source: the pull-mode architecture map (`_pull-mode-architecture-map.md`,
§8.3). Rejects: retrofitting FOCUS names onto the live rollup (churn with
no reader); ignoring FOCUS entirely (the first export surface would then
need a rename layer, and rename layers are where column meanings quietly
drift apart).

## Constants

| Name | Value | Purpose |
|---|---|---|
| Nano scale | 1 unit = 10⁻⁹ of one currency unit; $1 = 1,000,000,000 units | exact integer money math; matches `CostNanoUSD`/`AmountNanoUSD` |
| `cost_source` values | `gateway`, `pulled` (`GOVERNANCE_COST_SOURCE`) | which lane the money came from, in one filterable column; the provider is the `Provider` column; `seat` and `trace` never appear |
| Rollup table | `governance_cost_rollup_1d` | the one summed table charts read |
| Rollup grain | 1 day (`toDate`) | matches bill grain; volume is thousands/day |
| Idle-seat default | 30 days without activity, per-org adjustable | FR3 wave-2 listing |
| Permission verbs | `governance_cost:view`, `governance_identity:manage` (registry names final at implementation) | ADR-092 registry entries gating the screens |
| Feature flags | `release_ui_ai_governance_enabled`, `release_ui_governance_billed_cost_enabled` — both already registered (backend + frontend registries), already gating nav and placeholder routes | staged rollout of the screens |
| Anthropic restatement window | 30 days back (#6978) | why overlap/dedup rules are read-time only |
| Billing credential keys (§21.1) | `billingClientId`, `billingClientSecret` in the existing `credentials` map; tenant reused from `tenantId` | the Azure Resource Manager identity, separate from the bot's `clientId`/`clientSecret` |
| Prepaid declaration (§21.4) | `azureBillingIsPrepaid: boolean`, customer-set on the connection, default `false` | the only thing that licenses the prepaid sentence; never inferred |
| One-app choice (§21.1 form default, v3.7) | `azureBillingUsesSameApp: boolean`, written by the create form's builder beside a claimed subscription, default `true` | the only durable record of whether the billing pair is a copy of the bot's or a second app; nothing reads it at run time — the edit path (#7777) will |
| Spend-lane reasons (§21.3) | `billing_read_failed`, `prepaid_declared`, `no_spend_recorded` | closed list bounded by what the system can know (v3.4: `awaiting_grant` withdrawn with §21.6; `billing_access_denied` folded into `billing_read_failed` — 403 and 429 die at the same line today; `no_billing_credentials` became a save-time refusal, `assertAzureBillHasItsOwnCredential`, so the state cannot be stored to need a sentence — true on every write path only since v3.5, which closed the create that still passed through); the screen maps each to a sentence, provider text never reaches the browser |
| Azure cost read interval | 6 h (`AZURE_COST_READ_INTERVAL_MS`), max hold 7 d (`AZURE_COST_MAX_HOLD_MS`) | already shipped; the allowance is a few requests/minute **shared with the customer's own portal users** |
| `SETTLING_WINDOW_DAYS` | 30 days, overridable per ingestion source; measured for Anthropic only, provisional for Azure/Databricks | §15: a day renders *provisional* while fewer than this many days have passed since **a pull last touched that day** (not since the day itself); gateway rows are exempt; no provider feed supplies finality |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| Bill = total | per provider/day with a bill: the billed lane's displayed total equals the provider's **pre-tax cost-feed subtotal** (§2 bill composition — refund days may be negative, never clamped); in the wave-2 connected view, gateway split + unallocated line sum to it exactly | query-time §2 rule; test: split + unallocated = bill for seeded over-, under-metered *and negative* days (wave 2) |
| No cross-currency sums | no query ever adds amounts with different currency codes | `CurrencyCode` in the rollup's ORDER BY (dedup key) and every group key; test: mixed EUR/USD seed renders two totals |
| Full-grain dedup key | the rollup's ORDER BY is `(TenantId, Day, CostSource, IngestionSourceId, Provider, Model, AgentId, CurrencyCode, RawActorId)` and equals its full dimension tuple — no *dimension* exists only as a payload column. `OrganizationId` is payload by design (`TenantId` already addresses the row; keying on it would make an org rename a key change), as are the markers `RevisedAt`, `PreviousAmountNano` and `LastObservedAt` | schema review gate; test: two actors (and two currencies) sharing all other dimensions on one day, `OPTIMIZE … FINAL`, sum still equals both rows |
| Dedup-safe reads | every query on the rollup uses `argMax` over `EventTimestamp` — the ReplacingMergeTree's replacement version, *not* the `Version` schema-snapshot stamp — or the IN-tuple pattern (ADR-015:98), never plain SUM | thin-service query helpers; test: seed pre- and post-restatement versions of one day *without* OPTIMIZE, read must return only the restated amount |
| Rebuild = replay | dropping `governance_cost_rollup_1d` and replaying events reproduces it exactly | ADR-015 fold projection; test: replay equality on seeded corrections |
| Erasure never mutates a key | an erased actor id leaves the rollup by delete-then-replay, never by `ALTER TABLE … UPDATE` on `RawActorId` — ClickHouse refuses mutations on a sorting-key column | §9 step 4; test against the deployed ClickHouse version: the `UPDATE` is rejected, and erase → delete → replay leaves only the pseudonymized key with the original total |
| One dollar, one home | a dollar appears in exactly one channel; wave 1: structural — lanes are never summed into one figure (§1); wave 2: the combined view counts each dollar once | wave 1: no cross-lane sum exists (code review gate); wave 2: §7 key-to-bill mapping + exclusion filter, blocking prerequisite of the combined view; test: gateway row whose key maps to a pulled bill is excluded from the combined total once |
| Pulled rows never enforce | no budget resolver ever reaches `Scope="pulled"` rows | structural, ADR-088 Decision 3 (unchanged) |
| Raw ids stay raw | actor-id columns contain only what the provider sent; no resolved name or person id is ever written into a money row | §9; code review gate + test: ingest path has no identity lookup |
| Identity grants nothing | no authz code path reads `DiscoveredPerson`/`DiscoveredAgent`/`IdentityMatch` | hard constraint 3; test: authz engine module has no import of identity tables |
| Matches are dated and evidenced | every `IdentityMatch` row has evidence kind + validFrom; corrections close and reopen, never rewrite | §11/§12; unique-open-link constraint + test |
| No figure we did not read | the spend lane renders a currency amount only when a cost read returned one; every other state renders a sentence from the closed reason list, never `0` and never blank | §21.3; table-driven test over all three reasons asserting each renders its sentence and **none** renders a currency amount (`azureBillingNote.unit.test.ts`, digit-free assertion) |
| The billing identity reads only money | the Resource Manager token is minted from `billingClientId`/`billingClientSecret`; the Dataverse and Graph tokens are minted from the bot's — no code path mints one from the other's credentials, and no fallback exists | §21.1; test: with billing credentials absent, the cost read is skipped and **zero** Resource Manager calls are made — asserted on the captured call list, not on the absence of a log line |
| Billing secrets never echo | `billingClientSecret` is never returned to the browser on read or edit, and survives an edit that does not resend it | §21.2; `ingestionSourceSecretFields.unit.test.ts` extended to the new keys — merge blocker |
| Prepaid is declared, never derived | the prepaid sentence is reachable only when `azureBillingIsPrepaid` is set; no code path sets it from response data | §21.4; test: zero-row cost read with seats present renders `no_spend_recorded`, not `prepaid_declared` |

## Assumptions

| Assumption | What breaks if false |
|---|---|
| Provider admin APIs stay pull-accessible at current auth scopes | that provider's billed lane goes dark; screens show "no data since [last pull]", never zero — backed by the §4a `IngestionSource` health join, not by hope; FR5 coverage shrinks, design survives |
| Volume stays thousands of rows/day (daily buckets, per-statement rows) | millions/day would force hourly grain + ADR-034-style routing; upgrade path exists, fan-out not chaining |
| One writer per money lane | a second writer stamping the same spend breaks one-dollar-one-home; guarded by the exclusion-filter invariant test |
| `event_log` retention covers the replay horizon (ADR-022: retention is the durability ceiling) | rollup days older than retention keep their last projected values and cannot be rebuilt; restatement markers on those days freeze |
| SCIM/Entra directory data flows for department links | orgs without it degrade to "unassigned" department; per-person drill still works via provider-native ids |
| Azure serves `totalCostUSD` on the customer's agreement type (unprobed — §20) | the biller-conversion column stays 0 for Azure; per-currency totals still correct; single-total view waits for a rate table |
| Databricks grants the puller SCIM read + system-table access under app-only auth (SCIM listing unprobed; privilege bar is high — §20) | Databricks people arrive nameless (UUIDs/emails from query history only); identity wave degrades to email evidence; cost lane unaffected |
| The billed subscription sits in the **same tenant** as the Copilot environment, so the billing identity can reuse `tenantId` (§21.1) | cross-tenant billing arrangements (CSP, Lighthouse) cannot connect the bill at all until an optional `billingTenantId` ships; conversations and seats are unaffected — open question below |
| An Azure cost response with zero rows means "nothing billed", not "we were refused" — refusals arrive as 401/403/429, not as an empty result (§21.3) | a permission failure renders as `no_spend_recorded` and the customer waits forever for a read that will never succeed; the closed reason list stops being honest. **Verified in the puller** (v3.4): a non-OK status takes the held branch (`copilotStudioDataverse.puller.ts:1115-1128`), never the priced one; only a parsed 200 can price a window |
| No API exposes prepaid credit consumption (§21.4) | **already known to be shaky** — the M365 admin centre renders month-to-date credits per agent, so an endpoint likely exists and our search for it failed. If one is found, §21.4's declaration flag becomes a fallback for un-probed tenants rather than the only source, and the prepaid sentence is replaced by a real figure. Nothing in this design has to be undone |
| Customers who are prepaid will tick the prepaid box (§21.4) | a prepaid customer who leaves it unticked sees `no_spend_recorded` — "no spend recorded this period" — which is *true but unhelpful*; they conclude the integration is broken rather than that Azure cannot see their credits. Mitigation is copy, not architecture |

## Gates

| Path | Reversible? | Blast radius | Gate |
|---|---|---|---|
| ClickHouse migration `ALTER`ing `governance_cost_rollup_1d` (the table itself shipped in wave 1 as 00087; wave 2 adds `RevisedAt`, `PreviousAmountNano`, `LastObservedAt`) | no (schema) | large | human review + a written manual rollback (`DROP COLUMN` per added column — the down path is narrower than wave 1's `DROP TABLE` precisely because the table is not ours to drop any more) — repo convention keeps data-touching down paths commented out, and no down-testing harness exists, so "tested down path" would be a false promise |
| Prisma migration adding the identity tables, seat price list, coverage, tenant history, suppression list and suggestion index | no (schema) | large | human review + reversibility reviewed in PR (Prisma migrations here have no down files; rollback is a follow-up migration); the migration is also the repo's first `CREATE EXTENSION` (`btree_gist`, §7) — it must check availability and fail actionably, and the self-host docs and Helm chart must state the requirement |
| Rollup fold projection | yes (replayable) | large | automated: replay-equality test; feature flags gate the screens (no §7 dependency in wave 1 — lanes never summed) |
| Exclusion filter + key-to-bill mapping (wave 2) | yes | large (money correctness) | automated: one-dollar-one-home test suite is a merge blocker for the first lane-merging screen |
| Auto-link on deterministic evidence | yes (links are dated; closing reverses) | medium | automated: conflict-rule tests (two candidates → suspend + flag); fuzzy scoring runs **only** in §12's background suggestion job, never inline in a request — test: no request path computes an edit distance |
| GDPR erasure blanking person references | no | large | human review, always; erasure blanks person fields, money amounts stay |
| Screens behind flags | yes | small | none — ship it |
| Seat price list edits (admin) | yes (recompute at read heals) | small | none — audit-logged, no approval step |
| Billing credential keys on the connection form (§21.2) | **no** — a secret echoed to a browser stays echoed | medium | human review of the form diff (both credential builders: `dashboard/pages/inventory.tsx:2647` create and `:2702-2708` edit — a change applied to one and not the other is the failure mode), **plus** `ingestionSourceSecretFields.unit.test.ts` extended to `billingClientSecret` as a merge blocker |
| Dropping the bot-identity fallback for the cost read (§21.1) | yes (re-add credentials) | small — **no connected source can be in this state**: `azureSubscriptionId` has never shipped to `main`, so it arrives in the same release as the save-time refusal and no stored source claims a bill without the pair | automated: ships behind `release_ui_governance_billed_cost_enabled`; the refusal is `assertAzureBillHasItsOwnCredential` on create AND on an edit that adds the claim (v3.5). A source claiming nothing reads no bill, exactly as today |
| Spend-lane reason states (§21.3) | yes | medium (customer-visible money) | automated: the three-reason table-driven test + the no-currency-amount assertion; behind the existing flag |

## Schema

Sketches, not DDL — the exact shipped statement is the migration.

`governance_cost_rollup_1d` **already exists**: it shipped with wave 1 as
migration `00087`, and the `CREATE TABLE` below is shown whole only
because a column list is the readable way to say what the table means.
Wave 2 does not create it. The three columns wave 2 adds — `RevisedAt`,
`PreviousAmountNano`, `LastObservedAt` — arrive by **`ALTER TABLE … ADD
COLUMN`**, and their defaults are what a reader should check: existing
rows get `LastObservedAt` = epoch, so every pre-migration day reads as
long since observed and therefore *settled*. That is the right answer
rather than a compromise, because the pullers look 30 days back: any day
still genuinely in its settling window gets re-stamped on the next daily
pull, and any day the backfill "wrongly" called settled was one no pull
was ever going to touch again.

```sql
-- ClickHouse: the one summed table (fed by fold projection, NOT an MV).
-- As shipped in migration 00087 — read that file, not this block, when
-- the two ever disagree. Wave 2 ALTERs it, it does not create.
CREATE TABLE governance_cost_rollup_1d (
    -- ---- the sort key: the fold's group key, exactly ----
    TenantId           String,        -- the org's hidden governance project
    Day                Date,          -- the provider's business day (UTC)
    CostSource         LowCardinality(String),  -- §5 values
    IngestionSourceId  String DEFAULT '',       -- '' for gateway rows
    Provider           LowCardinality(String) DEFAULT '',
    Model              LowCardinality(String) DEFAULT '',
    AgentId            String DEFAULT '',       -- provider-native, '' if none
    CurrencyCode       LowCardinality(String) DEFAULT 'USD',  -- §3
    RawActorId         String DEFAULT '',       -- §9: what the provider said

    -- ---- payload (not part of the row's identity) ----
    OrganizationId     String DEFAULT '',       -- who the money belongs to
    ExactOrEstimate    LowCardinality(String) DEFAULT '',  -- ADR-088 Dec. 6
    AmountNanoUsd      Nullable(Int64) DEFAULT NULL,  -- NULL, never 0
    AmountNanoMinor    Int64 DEFAULT 0,   -- provider's own figure, nano-minor
    TokensInput        UInt64 DEFAULT 0,
    TokensOutput       UInt64 DEFAULT 0,
    TokensCacheRead    UInt64 DEFAULT 0,
    TokensCacheWrite   UInt64 DEFAULT 0,
    RequestCount       UInt64 DEFAULT 0,
    RevisionCount      UInt32 DEFAULT 0,        -- §15 restatement history
    PreviousAmountNanoUsd Nullable(Int64) DEFAULT NULL,  -- §15 "was $X"
    RevisedAt          Nullable(DateTime) DEFAULT NULL,  -- §15 marker, wave 2 ADDs it
                                      -- (latest revision only)
    LastObservedAt     DateTime DEFAULT 0,      -- §15: when a pull last TOUCHED this day.
                                      -- Wave 2 ADDs it. Written on every fold write that
                                      -- touches the row, not only on corrections — that is
                                      -- RevisedAt's job. A re-pull that confirms an
                                      -- unchanged figure still moves it, which is exactly
                                      -- the fact the provisional test needs. Read with
                                      -- argMax like every other payload column.
                                      -- Its value is the PULL'S OBSERVATION TIMESTAMP, taken
                                      -- off the event, never the wall clock at fold time: a
                                      -- clock read would stamp every day with today on replay,
                                      -- breaking "Rebuild = replay" and its equality gate, and
                                      -- would let §9 step 4's delete-then-replay flip a
                                      -- settled day back to provisional just because we
                                      -- erased someone. Off the event, replay reproduces it.
                                      -- Not the shipped LastEventOccurredAt: that is the max
                                      -- occurred-at of the events folded in — provider-side
                                      -- event time — and the two diverge in precisely the
                                      -- case that matters, a re-pull re-confirming old
                                      -- events. Our observation moved; theirs did not.
    PulledItemsJson    String DEFAULT '',       -- latest contribution per item
    Version            LowCardinality(String) DEFAULT '',  -- schema snapshot:
                                      -- it filters read-back to rows written by the current
                                      -- fold schema. It is payload, NOT the dedup version;
                                      -- the two must never be confused in a query.
    AppliedEventIds    Array(String) DEFAULT [],  -- redelivery dedup (00054)
    CreatedAt          UInt64 DEFAULT 0,
    LastEventOccurredAt UInt64 DEFAULT 0,
    EventTimestamp     UInt64                   -- the ReplacingMergeTree's replacement version
                                      -- (the fold's monotonic updatedAt). This is the column
                                      -- every dedup-safe read takes argMax over.
) ENGINE = ReplacingMergeTree(EventTimestamp)   -- via the
                                         -- CLICKHOUSE_ENGINE_REPLACING_PREFIX
                                         -- envsub, never a bare literal
PARTITION BY toYYYYMM(Day)
ORDER BY (TenantId, Day, CostSource, IngestionSourceId,
          Provider, Model, AgentId, CurrencyCode, RawActorId)
TTL toDateTime(Day) + INTERVAL 13 MONTH DELETE;
-- The ORDER BY is the dedup key and MUST equal the full dimension tuple:
-- any dimension omitted here is silently collapsed on background merge
-- (distinct actors' or currencies' money deleted, not just hidden — the
-- 00069 bug class). Low-cardinality columns lead so chart scans read a
-- cheap prefix; RawActorId sits last so per-person cardinality never
-- widens the prefix. ActorKind is not a column at all: it is determined
-- by (provider, RawActorId), never a distinguishing dimension.
-- `ExactOrEstimate` is deliberately OUTSIDE the key — a day moving from
-- estimate to exact is a restatement that must REPLACE, and in the key
-- both rows would survive and the day would read as double its cost.
-- OrganizationId stays out for a different reason: it is not a dimension
-- the row is distinguished BY, it is who owns the row TenantId already
-- addresses. RevisedAt, PreviousAmountNanoUsd and LastObservedAt are
-- markers about the row, not dimensions of it, and are likewise payload.
-- Retention is a fixed 13-month TTL, exempt from tenant retention
-- (following gateway_spend, 00067): cost records must not be governed by
-- a policy a customer can shrink to weeks.
-- ALL reads must be dedup-safe (argMax(col, EventTimestamp) or IN-tuple,
-- ADR-015:98) — dedup is eventual, plain SUM double-counts mid-merge.
```

```prisma
// Postgres: identity tables (§11) — beside ADR-101, never inside it
model DiscoveredPerson {
  id              String   @id @default(nanoid())
  organizationId  String
  provider        String           // "anthropic" | "openai" | "databricks" | ...
  rawActorId      String           // what the provider calls them (§9's join key)
  displayText     String           // name/email text as seen, verbatim
  kind            String           // person | service_account (deterministic, §10)
  firstSeenAt     DateTime
  lastSeenAt      DateTime
  suspendedAt     DateTime?        // §12 conflict rule: automatic linking stopped for this identity
  suspendedReason String?          // what tripped it, for the human who reviews
  // Suspension lives here, not on the suggestion rows (§12) — a halt on
  // auto-linking that a recompute or a restart clears is not a halt.
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
  userId             String?   // platform user; nullable — blanked by §9's erasure (step 2),
                               // which is keyed on DiscoveredPerson; the row and its dates remain
  evidenceKind       String    // directory_id | verified_email | human_confirmed
  validFrom          DateTime
  validTo            DateTime? // open link = null; offboarding/correction closes, never rewrites
  createdAt          DateTime  @default(now())
  // at most one OPEN link per discovered person — enforced with a partial unique index
  // (raw SQL in the migration: UNIQUE (discoveredPersonId) WHERE validTo IS NULL)
  // Overlap guard: no two rows for the same discoveredPersonId may have overlapping
  // validity ranges. Enforced by an exclusion constraint (raw SQL in the migration:
  // CREATE EXTENSION IF NOT EXISTS btree_gist;
  // EXCLUDE USING gist ("discoveredPersonId" WITH =,
  //   tsrange("validFrom", COALESCE("validTo", 'infinity')) WITH &&)).
  // tsrange treats NULL validTo as unbounded via COALESCE, so both open and closed
  // rows participate. Without it, a read-time join on validFrom <= spendDate < validTo
  // could match multiple rows.
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
  // Overlap guard: two price rows for the same (organizationId, provider, licenseType)
  // with overlapping validity would make the seat-money multiplication ambiguous.
  // Enforced by an exclusion constraint (raw SQL in the migration:
  // CREATE EXTENSION IF NOT EXISTS btree_gist;
  // EXCLUDE USING gist (
  //   "organizationId" WITH =, "provider" WITH =, "licenseType" WITH =,
  //   tsrange("validFrom", COALESCE("validTo", 'infinity')) WITH &&)).
}

model IngestionSourceKeyCoverage {
  id                String    @id @default(nanoid())
  organizationId    String
  ingestionSourceId String              // the connected bill
  virtualKeyId      String              // the gateway key that bill pays for
  validFrom         DateTime            // §7: UTC midnight only — a day is the finest grain a bill can own
  validTo           DateTime?           // open coverage = null; re-pointing closes, never rewrites
  // Overlap guard, and the ONLY uniqueness rule here: same btree_gist
  // exclusion pattern as IdentityMatch —
  // EXCLUDE USING gist ("virtualKeyId" WITH =,
  //   tsrange("validFrom", COALESCE("validTo", 'infinity')) WITH &&).
  // It already rejects a second open row for a key (SQLSTATE 23P01), so
  // NO partial unique index is added on top: the redundant index would only
  // make the common race surface as 23505 instead, two codes for one rule
  // (§7). The application maps 23P01 to a named domain error — today the
  // repo maps Prisma's P2002 and no exclusion violation anywhere.
  // Zero-width and inverted rows slip past an exclusion constraint (an empty
  // range overlaps nothing, not even itself), so:
  //   CHECK ("validTo" IS NULL OR "validTo" > "validFrom").
  // relationMode = "prisma" means these are not real foreign keys: a trigger
  // ties this row's organizationId to the virtual key's own organizationId,
  // or an open row can name the wrong org, or outlive its key and hold that
  // key's one open slot forever (§7).
  // Gaps are NOT a database guarantee — a non-overlap constraint cannot see
  // one. Re-pointing is a single transaction (SELECT ... FOR UPDATE on the
  // open row, close it and open the successor together) (§7).
}

model GovernanceTenantHistory {
  id             String   @id @default(nanoid())
  organizationId String
  tenantId       String            // a hidden governance project id this org has written rows under
  firstUsedAt    DateTime
  lastUsedAt     DateTime
  // §11: every TenantId the org has EVER written governance rows under,
  // appended on first use and never pruned. Reads and erasure resolve
  // against the whole history; the live resolveGovProjectId call only finds
  // today's write target and filters archived projects, so it cannot be the
  // historical translation without going permanently blind after an archive.
  @@unique([organizationId, tenantId])
}

model ErasedIdentifierSuppression {
  id             String   @id @default(nanoid())
  organizationId String
  provider       String            // scoped: the same string can be a different person elsewhere
  identifierHash String            // hash of the erased identifier — never the identifier
  erasedAt       DateTime
  // §9 step 1: consulted by EVERY write path that carries the identifier —
  // DiscoveredPerson creates/updates, governance_ocsf_events writes
  // (ActorEmail and the raw payload) and seat-pull row writes — each of
  // which skips a suppressed identifier. Without it the next
  // 30-day-lookback pull re-creates the row the erasure just removed.
  // §9 step 5: the fold also membership-tests against it at replay and
  // recomputes the deterministic pseudonym on a hit, which is why no
  // original-to-pseudonym mapping table exists (one would hold the erased
  // identifier in plaintext forever). This is the only table erasure adds.
  @@unique([organizationId, provider, identifierHash])
}

model IdentityMatchSuggestion {
  id                 String   @id @default(nanoid())
  organizationId     String
  discoveredPersonId String
  userId             String            // the platform user this might be
  score              Float             // edit-distance score, after the §12 prefilter
  computedAt         DateTime
  // §12: written by the background suggestion job, read by the review
  // screen; the screen never scores anything itself. Recomputed when
  // discovery or org membership changes, never per page view. Confirming a
  // suggestion writes an IdentityMatch row and closes this one.
  // Suspension lives on DiscoveredPerson, not here — a recompute must not
  // clear a conflict halt.
  @@unique([organizationId, discoveredPersonId, userId])
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
  (Lago's pattern, and the pre-ADR research proposal's own v1
  recommendation).
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
- **A separate billing connection type** — the bill is per subscription
  and every environment bills to one, so it would stand in exactly one
  relationship to the Copilot connection forever, while doubling the
  setup a customer must get right; separation of duty comes from the
  credential split, not the connection count (§21.1).
- **Falling back to the bot identity when billing credentials are
  absent** — silently re-creates the combined grant this section exists
  to break, in the one case nobody is watching (§21.1).
- **Inferring "prepaid" from persistently-zero spend** — an empty cost
  feed is identical to a quiet month; the guess prints a confident
  falsehood about a customer's contract (§21.4).
- **Provider error text on the customer's screen** — untranslatable,
  changes without notice, can carry identifiers (§21.3).
- **Turning the connection red on a billing failure**, or adding an
  amber third state — red sends the investigator after a bot fault that
  does not exist; amber is a new state across every connection type
  (§21.5).
- **A shared spend/seat lane type now** — abstraction at n=2; the second
  caller would bend to the first's shape (§21.7, §19's reasoning one
  level down).

## Consequences

**Positive.** Pulled money finally has a reader; totals reconcile against
invoices by construction; identity lands without rewriting a single money
row; a provider restating history updates screens with an explainable
marker; the closed PR stack is replaced by a document, not by memory.

**Negative.** Two sources of truth per overlap (bill + metering) must be
explained in the UI forever — from wave 2, the variance line is a
permanent tenant; in wave 1 the two lanes simply sit side by side,
unreconciled, and users must be told not to add them. Mixed-currency
orgs see two totals until a biller-converted column or a rate table
exists. The exclusion filter and key-to-bill mapping are a hard blocker
on the wave-2 combined view — schedule risk moved there, off the wave-1
rollup. Seat money computed at read means
exports must run the same multiplication (one shared code path, or
numbers drift). Read-time identity resolution makes per-person queries
join-heavy; acceptable at current volume, revisit if drill-downs slow.
**No Copilot connection that exists today loses a spend figure** — this
was written when §21 was expected to land after the subscription field,
and it did not: `azureSubscriptionId` has never reached `main`, so it
ships in the same release as the refusal that requires the billing pair
beside it. Every connection that exists today claims no subscription,
reads no bill, and is unchanged. Customers now have two Azure grants to
obtain rather than one, and the second one has a different approver —
the reason it is worth doing is also the reason it is slower to adopt.
That cost lands on the customers who adopt the spend lane next, not as a
regression for the ones already connected.

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
| Copilot prepaid-credit visibility — **one-script probe**, not a changelog watch: the M365 admin centre renders month-to-date credits per agent, so an endpoint plausibly exists and our earlier search for it failed. Probe it; record the answer in the Assumptions table either way (§20's rule) | Sergio |
| Cross-tenant billing: does any real customer bill the subscription from a different tenant than the Copilot environment? If yes, `billingTenantId` becomes a third billing key (§21.1 assumption) | deferred until one appears |
| Should the connection form stop asking for the subscription id at all? The billing identity **finds the subscription by itself** (measured, `configuration.md`: "the form does not need to ask for it, and should not"). Removing the field would also dissolve #7738's uniqueness race, which is a race on that very field | Sergio — sequence against #7738 |
| Does a failed billing read count toward the source's `errorCount`? §21.5 fixes the *health colour*; the error counter is a separate mechanism — the cost read already refuses to feed it by contract (`azureCostManagement.ts:200`) | resolved v3.4 — it does not, verified |
| The seat lane's `read_failed` fires only when our own store query throws (`governanceCost.service.ts:275-295`); a provider-side Graph 403 writes no rows and renders as `awaiting_data`. Same collapse §21.3 forbids for spend — does the seat lane get the same honesty pass? | Sergio — follow-up issue |
| A reason surviving the puller: 403 vs 429 die at the same `return null` (`copilotStudioDataverse.puller.ts:1128`), so `billing_read_failed` cannot yet say *refused* vs *throttled*. Worth threading a reason through the cursor? | implementation PR or follow-up |
| ~~The rollup's `costSource` is the LANE (`pulled`), not the provider, and the Azure billing note reads pulled-lane content as Azure content~~ | resolved in the implementation PR — the premise ("Azure is the only pulled producer") was already false: the OpenAI, Anthropic and Databricks admin pullers feed the same lane today, so a mixed org's note fell permanently silent, including the failed-read warning. The note's spend check now asks the rollup for the CLAIMING SOURCE's own rows (`hasRowsForSource`, keyed on `IngestionSourceId`), never the lane's |
| Two sources may claim two DIFFERENT subscriptions (the ownership guard refuses only a duplicate), and the spend panel carries one note — the oldest claim speaks (`createdAt` order, deterministic). One note for two bills is unresolved | before a second claiming source is a real shape |
| Azure and Databricks restatement windows are unmeasured; `SETTLING_WINDOW_DAYS` stays provisional for those sources until probed (§15) | Sergio / puller implementer |
| Payload-level redaction for `governance_ocsf_events` — the raw OCSF JSON holds names and email addresses that a single-column pseudonym cannot reach; wave 2 answers with delete-and-suppress (§16), a redacting read path or structured columns is owed | identity implementer |
| `btree_gist` availability per managed-Postgres provider (Azure Database for PostgreSQL unverified) — the repo's first `CREATE EXTENSION` (§7) | Sergio |
| LWQL org-wide cost surface (§17) — own design pass, wave 2+ | deferred |
| Registry-final permission verb names (§18) | implementation PR |

## Revisions

- **v3.9 (2026-09-02, captain: Sergio Esteban).** Red-team panel on the
  wave-2 lock: five independent refuters attacked the claim that the six
  v3.8 lock decisions could be implemented without violating a hard
  constraint, producing a wrong money total, or leaving an erasure
  incomplete. All five returned "refuted", with executed evidence — the
  claim died and no decision survived exactly as written. Two components
  were redesigned and four narrowed; every ratified fix is folded in.
  Status unchanged (Proposed).
  - **Re-pointing a key is one transaction, and the constraints are
    corrected** (§7, Schema, Gates): a non-overlap constraint cannot see a
    *gap*, and two independent updates were proved on live Postgres to
    leave an hour of spend covered by no bill, silently. Re-point is now a
    single `SELECT … FOR UPDATE` transaction. The redundant partial unique
    index is **dropped** (the exclusion constraint already rejects a second
    open row; keeping both made the common race surface as 23505 instead of
    23P01), a `CHECK ("validTo" IS NULL OR "validTo" > "validFrom")` closes
    the zero-width and inverted rows that slip past an exclusion
    constraint, 23P01 gets a named domain error with operator copy, a
    trigger ties the coverage row's org to the key's org, and a re-point
    takes effect at the next UTC midnight because the rollup buckets by
    day. Deployment note added: `btree_gist` is the repo's first
    `CREATE EXTENSION` in 297 migrations.
  - **Org → `TenantId` is a persisted history, not a live lookup** (§11,
    Schema): archiving the governance project made the read resolver return
    null forever while the write path kept resurrecting the archived
    project — a permanent split-brain in which a ClickHouse erasure job
    would erase nothing and report success. `GovernanceTenantHistory`
    records every tenant the org has written under; reads and erasure
    resolve against all of them. Plus `kind` guards on the project archive,
    update and GET-by-id paths, since only the list surface filtered
    governance projects and `PATCH /api/projects/:id` reached them.
  - **Erasure is keyed on `DiscoveredPerson`, with a suppression list**
    (§9, §11, Schema): v3.8 drove erasure from `lw.identity.user_erased`,
    which fires for no one today (the identity latch ships closed), can
    never fire for the majority of discovered people (they have no
    LangWatch login by construction), carries no identifier values in its
    payload, and is unreplayable if missed. The erase action on the
    discovered-person record now drives every step;
    `ErasedIdentifierSuppression` stops the next 30-day-lookback pull from
    re-creating the erased row; the event is demoted to an optional
    supplementary trigger. The suppression check gates **every write path
    that carries the identifier**, not only `DiscoveredPerson` — the OCSF
    event writes (the structured `ActorEmail` column and the raw payload)
    and the seat-pull row writes included, because deleting rows that a
    nightly pull re-writes is not an erasure. And there is **no
    `ErasedActorId` mapping table**: a stored table of
    original-to-pseudonym pairs would keep the erased identifier in
    plaintext forever, contradicting the hashes-only suppression list in
    the same section. None is needed, because the pseudonym is
    deterministic — at replay the fold already holds the original value,
    tests its hash for membership, and on a hit recomputes
    `SHA-256(secret ‖ original)` — one digest, computed once per write and
    used both as the membership key and as the replacement value, since
    the suppression list's `identifierHash` and the pseudonym are the same
    function of the same input. Scope is `(organizationId, provider)`
    throughout, on the list and on the lookup alike, so an address erased
    at one provider is not suppressed when a different provider reports
    it. The rollup half of the erasure deletes by **`TenantId`** — every
    tenant in `GovernanceTenantHistory` for the org — not by
    `OrganizationId`, which is payload carrying `DEFAULT ''` and would let
    the predicate skip rows and leave the erased identifier in place.
    `ErasedIdentifierSuppression` is the only table erasure adds.
  - **Match suggestions are computed in the background and stored** (§12,
    Schema, Gates): this **reverses** v3.8's compute-at-read ruling.
    Measured at the ADR's own example size, 2,000 discovered people × 500
    users is 1M pairs and 2.9 s of blocked event loop per page load, with
    no database fuzzy route available; and no-storage forecloses the
    pending-count badge. `IdentityMatchSuggestion` holds rows written by a
    job that prefilters (length band, shared token) before scoring and
    recomputes on discovery or membership change.
    `DiscoveredPerson.suspendedAt`/`suspendedReason` stay exactly as
    ratified. The Gates row claiming "no fuzzy path exists in code" is
    corrected to the real gate: fuzzy scoring runs only in the background
    job, never inline in a request.
  - **The provisional window anchors on the pull, and renders alongside
    revised** (§15, Constants): calendar age marked a 90-day backfill
    settled sight-unseen and kept weekly-pull sources provisional 23 extra
    days, so the window now counts days since a pull last touched the day.
    That anchor needs a place to live, so the rollup gains a
    `LastObservedAt` payload column (Schema), moved forward by every fold
    write that touches the day — a re-pull confirming an unchanged figure
    included, which is exactly what `RevisedAt` would miss; the flag stays
    computed at read, now *from* that stored timestamp. Its value is the
    **pull's observation timestamp, carried on the event**, never the wall
    clock at fold time: a clock read would make replay non-deterministic,
    breaking "Rebuild = replay" and its equality gate, and would let §9's
    delete-then-replay erasure flip settled days back to provisional. §4
    states the mechanism the marker depends on — a pull that confirms an
    unchanged figure still appends an event — and the Schema records why
    the shipped `LastEventOccurredAt` cannot serve as the anchor: it is
    provider-side event time, which stands still in exactly the
    re-confirmation case this marker exists to notice.
    revised ∧ provisional is the **normal** case, not a contradiction —
    Anthropic revises within 30 days and the window is 30 days — and the
    cell shows both: *"revised, was $X — may still change"*; the v3.8
    sentence calling the two markers opposites is corrected. Gateway rows
    (`IngestionSourceId = ''`) are exempt: metered in real time, never
    restated. Azure and Databricks windows are recorded as unmeasured.
    §15's restatement mechanics (`RevisedAt`, `PreviousAmountNano`) were
    not refuted and are unchanged.
  - **Seat events carry PII obligations, inside the same PR** (§16, §20a):
    `governance_ocsf_events` gets a **fixed 13-month `TTL … DELETE`
    declared in its migration** and stays **out** of
    `RETENTION_TABLE_CATEGORY_MAP` and `TABLE_TTL_CONFIG` — which is what
    migration 00087 actually did for the rollup, and the two halves are not
    interchangeable: the reconciler's `MODIFY TTL` replaces the whole TTL
    expression atomically (`ttlReconciler.ts:463`), so enrolling the table
    would overwrite the fixed bound with a customer-settable one and let a
    customer hold personal data past 13 months. Seat-assignment rows are
    excluded from the SIEM export — a pre-existing defect the seat feature
    must not compound. The raw OCSF payload holds names and email
    addresses that single-column pseudonymization cannot reach: wave 2
    answers with delete-and-suppress, complete only because the
    suppression check also sits on the OCSF and seat-pull write paths, and
    records the redaction story as owed. The per-user Graph endpoint
    paginates and the current pull does not (~30k rows/day at 10k seats ×
    3 SKUs).
  - **The rollup sketch is corrected to the shipped table, and the table
    counts to the schema** (Schema, Invariants, §11): the sketch had no
    `TenantId` column and led its ORDER BY with `OrganizationId`, while
    the shipped migration 00087 leads with `TenantId` and carries
    `OrganizationId` as a payload column defaulting to `''` — ownership is
    an attribute of the row, its address is the tenant. §11 and the new
    `GovernanceTenantHistory` design already assumed the shipped shape, so
    the drift was confined to the sketch and the "full-grain dedup key"
    invariant. The invariant now matches the shipped table exactly and
    states which columns are payload by design rather than implying every
    column belongs in the key; the sketch is **corrected in tenancy, dedup
    key and replacement version** but remains a sketch — it still names
    `PreviousAmountNano` where 00087 says `PreviousAmountNanoUsd`, and
    omits `RevisionCount`, `PulledItemsJson`, `AppliedEventIds`,
    `CreatedAt` and `LastEventOccurredAt` entirely. **The exact DDL is
    00087**, and the Schema section now says so rather than reading like
    a specification of a table wave 2 is about to create. The same pass
    fixed the sketch's `Version UInt64` replacement column: shipped 00087
    replaces on `EventTimestamp UInt64` and keeps `Version` as a
    `LowCardinality(String)` schema-snapshot stamp — payload, not the
    dedup version — so every `argMax`-on-`Version` instruction in §4, the
    Invariants and the sketch pointed readers at the wrong column. §4 also
    still enumerated `org` as a rollup dimension and asserted every listed
    dimension was in the key; both corrected. And the migration this
    implies is stated for the first time: the rollup **shipped in wave 1**,
    so wave 2's three columns land by `ALTER TABLE … ADD COLUMN`, not a
    create — `LastObservedAt` backfilling as epoch, which reads every
    pre-migration day as settled and is correct rather than merely
    tolerable, since a day still in its window is re-stamped by the next
    30-day-lookback pull. The Gates row that promised a "migration adding
    `governance_cost_rollup_1d`" is corrected along with its rollback,
    which is now `DROP COLUMN` rather than a `DROP TABLE` of a table wave 2
    does not own. §11's
    "three Postgres tables" is likewise restated as six, the fold having
    added `GovernanceTenantHistory`, `ErasedIdentifierSuppression` and
    `IdentityMatchSuggestion` to the original three.
  - **Pre-existing defects written down** (§20a new, Open questions): four
    findings that predate this ADR — the un-TTL'd, unfiltered
    `governance_ocsf_events` already carrying provider emails from four
    shipped pullers; the archivable governance project; the ADR-101 §5
    event-log erasure service that was never written; the closed identity
    latch — with which of them wave 2 fixes and which are tracked
    elsewhere.
  - *Numbered v3.9 rather than v3.4 on rebase: wave 1 shipped v3.3–v3.7 to
    `main` in parallel with this branch.*

- **v3.8 (2026-09-01, captain: Sergio Esteban).** Wave-2 lock completed; the
  two #7740 forks plus four gaps found in the lock-completeness pass, all
  ratified:
  - **Identity and erasure key on `organizationId`** (§11, Schema): the
    rollup's `TenantId` is the hidden governance project's id, and that id
    is not durable — the resolver filters archived projects and the re-mint
    path can return an archived row, so keying on it could orphan the very
    rows an erasure job must find. Reads translate org → tenant through the
    `resolveGovProjectId` call every cost read already makes.
  - **Key-to-bill mapping is a dated join table** (§7, Schema, Open
    questions): `IngestionSourceKeyCoverage`, with a partial unique index
    holding one-home in the database. Dates keep a June re-point from
    re-filing May; a list column on the source is rejected. Resolves the
    open question of that name.
  - **Erasure blanks matches through a listener** (§11, Schema): a
    governance subscriber to the existing `lw.identity.user_erased` event,
    not a step appended to the erasure service — so a future second erasure
    path cannot silently skip governance rows.
  - **Suggestions compute at read; suspension is stored** (§12, Schema): no
    suggestion table and its lifecycle, at the accepted cost of no
    dismiss-forever; `DiscoveredPerson.suspendedAt`/`suspendedReason`
    persist the conflict halt, which a restart must not clear.
  - **Idle-seat names come from per-user seat-assignment facts** (§16): the
    seat pull extends from counts to "this person holds a seat of type X on
    day D", appended on §6's spine — the only way to name a holder who
    appears in zero usage rows, and a stated expansion of stored personal
    data to the class §9 already carries.
  - **New surfaces speak FOCUS** (§22 new, §15, Constants): FOCUS names on
    new customer-visible surfaces and `x_` extensions where the standard has
    none, with the live rollup's internal names left alone; plus a
    *provisional* marker, distinct from *revised*, derived from a
    `SETTLING_WINDOW_DAYS` window because no provider feed states finality.
  - *Numbered v3.8 rather than v3.3 on rebase: wave 1 shipped v3.3–v3.7 to
    `main` in parallel with this branch.*

- **v3.7 (2026-09-03, captain: Sergio Esteban).** The create form's
  default flipped to one app registration for both reads (issue #7775).
  §21.1 gains the *Form default* paragraph: the builder copies the bot
  pair into the billing keys when the switch is on, the split
  arrangement stays the recommendation one flip away, and the choice is
  persisted as `azureBillingUsesSameApp` because sealed credentials
  cannot answer it later. Without this note the ADR and
  `copilot-studio-form-controls.feature` would assert opposite defaults.
  Nothing §21 enforces changed: the guard never compared the pairs, the
  no-fallback invariant holds (the copy is written at save, not
  substituted at read), and no reason list or health rule moved. The
  edit path deliberately ships separately (#7777) — today's form cannot
  edit this source type at all.

- **v3.6 (2026-09-02, captain: Sergio Esteban).** The subscription claim
  becomes fixed once the bill has been read. Review of the sealed-envelope
  swap (v3.4's "honest path") found it only honest before the first cost
  read: the cursor and the rollup rows are filed under the source, so a
  swapped claim showed the old subscription's spend under the new one's
  name and masked the failed-read note. An edit may still swap the claim
  before any cost read, and may drop the claim at any time; once cost
  memory exists, a different bill means a new source — the same
  archive-and-recreate rule the report already has, for the same
  recorded-spend-continuity reason. Verifying which subscription the
  memory belongs to stays withdrawn (§21.6); the guard refuses instead of
  guessing.

- **v3.5 (2026-09-02, captain: Sergio Esteban).** Review pass on the §21
  implementation. Two corrections, one of them load-bearing:
  - **The create path was still open.** v3.4 withdrew
    `no_billing_credentials` from the spend lane's closed reason list
    because the save-time refusal made the state unstorable. It did not:
    the guard waved creates through, reasoning that a create carrying no
    credentials "fails for the louder reason" downstream. Nothing
    downstream requires credentials, so a direct caller could store a
    claimed subscription with no billing pair. The refusal now covers
    create as well as claim-adding edits, which is what makes v3.4's
    withdrawal true rather than merely intended.
  - **The rollout consequence was wrong in the other direction.** Two
    passages said every already-connected source goes dark on deploy.
    They assumed the subscription field was already live; it has never
    reached `main`, so it ships alongside the refusal and no existing
    connection claims a bill at all. The blast radius of dropping the
    bot-identity fallback is small, not large, and the Gates row and the
    consequences paragraph now say so.

- **v3.4 (2026-09-02, captain: Sergio Esteban).** Red-team pass on §21
  and its derived scenarios: four independent refuters (reachability,
  surface, duplication, observability), all four landing. What changed:
  - **§21.6 withdrawn.** The save-time verification read had no seam
    (no save path reads cost; the six-hour gate holds), keyed on a state
    nothing stores (when a grant happened), and misread its own
    measurement (a subscriptions *list* returning empty, not a cost
    query being refused). The propagation delay survives as setup copy.
  - **§21.7 corrected.** The seat union is precedent for the *shape*
    only. Its `read_failed` fires solely on our own store query
    throwing; a provider 403 renders as `awaiting_data` — the very
    collapse §21.3 forbids. The seat lane's own gap is now an open
    question instead of an inherited standard.
  - **§21.3 grounded.** The reason list shrinks from six to four —
    `awaiting_grant` withdrawn with §21.6, `billing_access_denied`
    folded into `billing_read_failed` because 403 and 429 die at the
    same line in the puller and no reason survives to any reader. The
    reason channel is named as new construction: no DTO field, no
    cursor field, no renderer branch exists for it today.
  - **§21.2 sharpened.** Both never-echo guards match `"credentials"`
    by exact string equality; the billing keys go inside that envelope
    or they leak. Recorded as load-bearing.
  - Dissent recorded: the observability refuter showed the harness
    captures full request bodies and bearer tokens, so the credential-
    separation invariant is directly testable — two of the challenge
    briefing's own premises (URL-only capture, no fake timers) were
    wrong.

- **v3.3 (2026-09-01, captain: Sergio Esteban).** Adds §21 — the Azure
  billing identity and the honesty rule for the spend lane — and
  withdraws an overstated evidence claim. Supersedes issue #7733; the
  work is issued as #7745.
  - **Framing.** Decision scoped to Copilot Studio only, *not* stated as
    a rule for every connection: Databricks' permission model has not
    been examined, and asserting a rule for it would be asserting
    something unverified. Blast radius set at "a customer reads a wrong
    number" — reversible by deploy, nothing destroyed — which is why the
    gates below are automated rather than human, except on the secret
    path.
  - **Round 1 (four forks, two re-asked).** Two constraints assumed
    settled in discussion were deliberately *not* re-locked by the
    captain and so were re-opened rather than carried: the connection
    shape and the health colour. Both then locked as §21.1 and §21.5,
    with reasons that are now written down instead of remembered.
  - **Evidence correction, raised against this ADR's own text.** The
    captain challenged the prepaid claim directly ("do you have
    evidence?"). The cited `KNOWN_DEAD.md` exists in neither the repo
    nor the vault, and the underlying research note says in terms that
    the admin centre *does* render per-agent credits and that our search
    for the interface behind it was "a failed search, not proof that
    none exists". The Context bullet is rewritten to claim only what was
    measured — prepaid packs create no Azure resource, so the cost feed
    shows no Copilot line — and §20's probe list gains the endpoint
    hunt. **What survived the correction:** the design does not depend
    on the dead end being real; §21.4 asks the customer instead, which
    is correct either way.
  - **Round 2 (one new fork, found in prior art, not in discussion).**
    The research note records that Azure answers *empty* for a minute or
    two after the role is granted — identical to a refusal. §21.6 adds a
    save-time verification with a 3-minute window, because the six-hour
    read cadence would otherwise freeze a false "no billing access" for
    six hours. This widens #7745 beyond what was filed.
  - **Scaffolding fork: one-off, not shared** (§21.7). Seats already
    solves the same lane problem; this is the second occurrence, so the
    shape is copied rather than factored out.
  - **Recorded cost, not hidden:** every existing Copilot connection
    loses its spend figure on deploy (Consequences, Gates).

- **v3.2 (2026-08-29, captain: Sergio Esteban).** Eight pre-implementation
  rulings folded, one restructure:
  - **Lane interconnection moved to wave 2** (the restructure): wave 1
    ships billed, gateway and seat lanes independent and never summed
    (§1); §2's bill-splits/variance design and §7's exclusion filter +
    key-to-bill mapping are stamped wave 2. The filter drops off the
    wave-1 critical path — schedule risk moves to the wave-2 combined
    view.
  - **Coverage rule** (§7): explicit admin key-to-bill mapping;
    provider-wide coverage rejected (second unconnected account's
    dollars would be silently swallowed). Overrun on mapped keys =
    show the bill + the §2 variance line, never subtract.
  - **Estimated tag** (§2, wave 2): not-yet-billed days show the
    gateway number tagged *estimated*, computed at read; flips to the
    bill when it lands.
  - **Pulled-money visibility** (§18): org-scoped
    `governance_cost:view`.
  - **Puller unhealthy = 3 consecutive failed runs** (§4a).
  - **Seat price list = llmcost pattern** (§6): JSON source of truth →
    registry → prices; manual seed now, sync task later.
  - **Alerts are automations, out of wave 1** (§4a): signals stay
    queryable so a future automations layer attaches without redesign.
  - **Probe answers land in the Assumptions table** (§20).
- **v3 (2026-08-29, captain: Sergio Esteban).** Truth audit before lock:
  three independent auditors re-verified every claim against (1) the
  script kits' actual output artifacts, (2) the code in this repo, (3)
  the FinOps FOCUS standard. No design change; every edit makes a claim
  match its evidence:
  - **Claims downgraded from "measured" to "unprobed", with §20 probes
    named**: Azure `totalCostUSD` (appeared in zero scripts — it was a
    documentation claim promoted to a design foundation); Databricks
    SCIM listing under app-only auth (script ran, no artifact survives,
    a 403 would have passed silently); the 11/13 Entra match
    (prose-only); OpenAI credit netting (never checked). What *is*
    proven under app-only auth: Azure cost read, and Databricks
    human-email vs service-principal-UUID attribution in query history.
  - **Bill composition stated** (§2, Invariants): "the bill" is the
    provider's pre-tax cost-feed subtotal, refund days can be negative
    and render as-is (never clamped), and a discounted account's
    persistent "metering over bill" variance is the discount's expected
    signature, labeled as such.
  - **Identity evidence reordered** (§12, provider-behaviour): email is
    the primary join key per the research's own 2026-08-20 correction;
    `externalId` (IdP-only, daily-refreshed, provider-discouraged)
    corroborates but never stands alone.
  - **Numbers corrected**: the tooling-artifact count is 269/436 per
    `20b_query_history_by_app.csv` (273/443 was not derivable); the
    Copilot seat-price dead end is documented reasoning, not a
    `KNOWN_DEAD.md` probe (that file proves the credits API only).
  - **Machinery claims aligned with the repo**: the rollup projection
    consumes *events*, not the sibling tables (§4 diagram redrawn; two
    per-pipeline registrations, one table; `CLICKHOUSE_ENGINE_REPLACING_PREFIX`
    envsub); the Gates' "tested down path" replaced with what the repo
    actually supports (manual DROP rollback per the 00067 precedent;
    Prisma has no down files); §20's puller fix widened to status flip
    **plus a new last-successful-pull field** (`errorCount` has no
    production writer; `lastEventAt` is not success). FOCUS interop
    note added (§3): metered money is never exported as
    `EffectiveCost`.
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
    rollup-now vs direct grouped queries first (the pre-ADR research
    proposal's own v1 recommendation, with the rollup buildable losslessly later via
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
  rounds (2026-08-27/28) producing 29 recorded rulings, and one final fork
  round (governance one-off; Postgres identity home; proof-auto-links
  with conflict suspension; repo placement). Notable overrides along the
  way, recorded so the reasoning survives: "gateway wins" replaced by
  bill-is-total (§2, Sergio); MV replaced by fold projection (§4, adopted
  from the independent Opus review); seat money stored → computed at read
  over durable count events (§6, Sergio's event-sourcing framing).
  Dissent recorded: the Opus review proposed back-filling person ids onto
  historical rows — rejected (§9) as editing history; its bill-row dedup
  skipped whole rows — rejected (§2) as losing the remainder.
