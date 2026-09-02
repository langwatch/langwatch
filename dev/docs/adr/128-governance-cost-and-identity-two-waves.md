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
§9–§17 identity and wave 2, §18–§20 cross-cutting.

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
model exports cleanly if ever needed — `BilledAmountNano` →
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
which gateway keys that bill pays for (a schema addition on the source
config — the reason this waits for wave 2). The rule then reads:

- A gateway row whose key is **mapped** to a source: the bill replaces
  its number in the combined total; the row still splits the bill (§2).
- A gateway row whose key is **unmapped**: it stands alone as *metered*
  — its dollars are real and no bill claims them.
- Mapped keys' gateway sum **exceeding** the bill is §2's variance line:
  total stays the bill, the overrun is shown, never subtracted.
- **Cross-currency guard (§3):** the split/variance arithmetic requires
  the bill and its mapped gateway rows to share a currency code. When
  they differ (e.g. bill in EUR, gateway metering in USD) and no
  biller-provided USD conversion exists (`BillerUsdNano = 0`), the
  mapping is **ineligible** — both lanes render separately, each in its
  own currency, until a biller conversion or a dated rate table (§3 b)
  is available. Where a biller conversion *does* exist the split uses
  the converted amount column and the variance is computed in that
  currency; the original invoice currency is still shown alongside.

The mapping lives with the source config (small admin list, audited,
read at query time like every overlap rule). The exclusion filter stays
a **blocking prerequisite of the wave-2 combined view** — the first
screen that merges lanes cannot ship before it. Rejected: provider-wide
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

**Erasure.** When a provider-supplied raw actor id contains personal data
(e.g. an email address), GDPR erasure:

1. blanks `IdentityMatch.userId` (§11),
2. pseudonymizes `rawActorId` and `displayText` on the `DiscoveredPerson`
   row (hash-replace, preserving the row for spend attribution),
3. rewrites the rollup rows carrying that id so they carry the pseudonym
   instead. **Not with an `ALTER TABLE … UPDATE`:** `RawActorId` is in
   the ORDER BY, and ClickHouse refuses a mutation on a sorting-key
   column — the key *is* the row's identity, so a changed key is a
   different row rather than an edited one, and the engine will not
   pretend otherwise. Erasure goes through the rebuild path the rollup
   already has (§4: "a rebuild is a replay"): record the mapping (step
   4), `ALTER TABLE … DELETE` this organization's rows carrying the
   original value, then replay the affected days, which re-derives them
   with the mapping applied. The pseudonym is deterministic (e.g.
   `SHA-256(secret ‖ original)`) so every replay lands on one stable key
   rather than minting a new one per run.

   Bounded by the replay horizon, and honestly: for days older than
   `event_log` retention there is nothing left to replay from, so the
   delete is the whole operation and that actor's spend on those days
   leaves the rollup rather than reappearing pseudonymized. Totals for
   those days drop by the erased amount. The alternative — leaving the
   row and its personal data in place — is not one, so the erasure job
   records which days it could not rebuild instead of failing silently.
4. **Replay safety:** the fold / replay pipeline (§4) must apply the
   erasure mapping — a lookup from original `RawActorId` to its
   pseudonym — *before* writing the rollup row. Without this, a replay
   re-derives the original value from the raw event log and inserts it
   beside the pseudonymized row, duplicating the amount. The mapping is
   a small table (`ErasedActorId(organizationId, provider, original,
   pseudonym)`), joined during the fold's projection step. The key
   includes `organizationId` and `provider` because the same raw actor
   id string can appear under different providers or tenants — scoping
   prevents cross-tenant collisions. Tests, against the ClickHouse
   version we deploy rather than a mock: erase, replay, assert the
   rollup contains only the pseudonymized key with the correct total; a
   collision test with the same `original` under two providers; and one
   that asserts the mutation route is closed — an `ALTER TABLE … UPDATE`
   on `RawActorId` must be rejected, so nobody re-adds the step that
   cannot work.

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

### §16. Idle seats split across the waves (FR3)

- **Wave 1, the aggregate**: "you pay for N seats, M are assigned" per
  provider — both numbers straight from the provider's SKU/roster counts
  (bought vs assigned). No identity needed, no usage join.
- **Wave 2, the names and the activity**: an *active*-seat count (distinct
  raw actor ids on usage rows) and listing *which* seats are idle both
  require the roster ↔ usage-actor join (§11). Idle default: no activity
  for 30 days, adjustable per org; last-activity date always shown.
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

## Constants

| Name | Value | Purpose |
|---|---|---|
| Nano scale | 1 unit = 10⁻⁹ of one currency unit; $1 = 1,000,000,000 units | exact integer money math; matches `CostNanoUSD`/`AmountNanoUSD` |
| `cost_source` values | `gateway`, `pulled_anthropic`, `pulled_openai`, `pulled_azure`, `trace` (reserved, excluded v1) | channel + provider in one filterable column; `seat` never appears |
| Rollup table | `governance_cost_rollup_1d` | the one summed table charts read |
| Rollup grain | 1 day (`toDate`) | matches bill grain; volume is thousands/day |
| Idle-seat default | 30 days without activity, per-org adjustable | FR3 wave-2 listing |
| Permission verbs | `governance_cost:view`, `governance_identity:manage` (registry names final at implementation) | ADR-092 registry entries gating the screens |
| Feature flags | `release_ui_ai_governance_enabled`, `release_ui_governance_billed_cost_enabled` — both already registered (backend + frontend registries), already gating nav and placeholder routes | staged rollout of the screens |
| Anthropic restatement window | 30 days back (#6978) | why overlap/dedup rules are read-time only |
| Billing credential keys (§21.1) | `billingClientId`, `billingClientSecret` in the existing `credentials` map; tenant reused from `tenantId` | the Azure Resource Manager identity, separate from the bot's `clientId`/`clientSecret` |
| Prepaid declaration (§21.4) | `azureBillingIsPrepaid: boolean`, customer-set on the connection, default `false` | the only thing that licenses the prepaid sentence; never inferred |
| Spend-lane reasons (§21.3) | `no_billing_credentials`, `billing_read_failed`, `prepaid_declared`, `no_spend_recorded` | closed list bounded by what the system can know (v3.4: `awaiting_grant` withdrawn with §21.6; `billing_access_denied` folded into `billing_read_failed` — 403 and 429 die at the same line today); the screen maps each to a sentence, provider text never reaches the browser |
| Azure cost read interval | 6 h (`AZURE_COST_READ_INTERVAL_MS`), max hold 7 d (`AZURE_COST_MAX_HOLD_MS`) | already shipped; the allowance is a few requests/minute **shared with the customer's own portal users** |

## Invariants

| Invariant | Meaning | Satisfied by / test anchor |
|---|---|---|
| Bill = total | per provider/day with a bill: the billed lane's displayed total equals the provider's **pre-tax cost-feed subtotal** (§2 bill composition — refund days may be negative, never clamped); in the wave-2 connected view, gateway split + unallocated line sum to it exactly | query-time §2 rule; test: split + unallocated = bill for seeded over-, under-metered *and negative* days (wave 2) |
| No cross-currency sums | no query ever adds amounts with different currency codes | `CurrencyCode` in the rollup's ORDER BY (dedup key) and every group key; test: mixed EUR/USD seed renders two totals |
| Full-grain dedup key | the rollup's ORDER BY equals its full dimension tuple — no dimension exists only as a payload column | schema review gate; test: two actors (and two currencies) sharing all other dimensions on one day, `OPTIMIZE … FINAL`, sum still equals both rows |
| Dedup-safe reads | every query on the rollup uses `argMax`/IN-tuple (ADR-015:98), never plain SUM | thin-service query helpers; test: seed pre- and post-restatement versions of one day *without* OPTIMIZE, read must return only the restated amount |
| Rebuild = replay | dropping `governance_cost_rollup_1d` and replaying events reproduces it exactly | ADR-015 fold projection; test: replay equality on seeded corrections |
| Erasure never mutates a key | an erased actor id leaves the rollup by delete-then-replay, never by `ALTER TABLE … UPDATE` on `RawActorId` — ClickHouse refuses mutations on a sorting-key column | §9 step 3; test against the deployed ClickHouse version: the `UPDATE` is rejected, and erase → delete → replay leaves only the pseudonymized key with the original total |
| One dollar, one home | a dollar appears in exactly one channel; wave 1: structural — lanes are never summed into one figure (§1); wave 2: the combined view counts each dollar once | wave 1: no cross-lane sum exists (code review gate); wave 2: §7 key-to-bill mapping + exclusion filter, blocking prerequisite of the combined view; test: gateway row whose key maps to a pulled bill is excluded from the combined total once |
| Pulled rows never enforce | no budget resolver ever reaches `Scope="pulled"` rows | structural, ADR-088 Decision 3 (unchanged) |
| Raw ids stay raw | actor-id columns contain only what the provider sent; no resolved name or person id is ever written into a money row | §9; code review gate + test: ingest path has no identity lookup |
| Identity grants nothing | no authz code path reads `DiscoveredPerson`/`DiscoveredAgent`/`IdentityMatch` | hard constraint 3; test: authz engine module has no import of identity tables |
| Matches are dated and evidenced | every `IdentityMatch` row has evidence kind + validFrom; corrections close and reopen, never rewrite | §11/§12; unique-open-link constraint + test |
| No figure we did not read | the spend lane renders a currency amount only when a cost read returned one; every other state renders a sentence from the closed reason list, never `0` and never blank | §21.3; table-driven test over all four reasons asserting each renders its sentence and **none** renders a currency amount |
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
| ClickHouse migration adding `governance_cost_rollup_1d` | no (schema) | large | human review + a written manual rollback (`DROP TABLE`, the 00067 create-table precedent) — repo convention keeps data-touching down paths commented out, and no down-testing harness exists, so "tested down path" would be a false promise |
| Prisma migration adding the three identity tables + seat price list | no (schema) | large | human review + reversibility reviewed in PR (Prisma migrations here have no down files; rollback is a follow-up migration) |
| Rollup fold projection | yes (replayable) | large | automated: replay-equality test; feature flags gate the screens (no §7 dependency in wave 1 — lanes never summed) |
| Exclusion filter + key-to-bill mapping (wave 2) | yes | large (money correctness) | automated: one-dollar-one-home test suite is a merge blocker for the first lane-merging screen |
| Auto-link on deterministic evidence | yes (links are dated; closing reverses) | medium | automated: conflict-rule tests (two candidates → suspend + flag); no fuzzy path exists in code |
| GDPR erasure blanking person references | no | large | human review, always; erasure blanks person fields, money amounts stay |
| Screens behind flags | yes | small | none — ship it |
| Seat price list edits (admin) | yes (recompute at read heals) | small | none — audit-logged, no approval step |
| Billing credential keys on the connection form (§21.2) | **no** — a secret echoed to a browser stays echoed | medium | human review of the form diff (both credential builders: `dashboard/pages/inventory.tsx:2647` create and `:2702-2708` edit — a change applied to one and not the other is the failure mode), **plus** `ingestionSourceSecretFields.unit.test.ts` extended to `billingClientSecret` as a merge blocker |
| Dropping the bot-identity fallback for the cost read (§21.1) | yes (re-add credentials) | large — **every already-connected source's spend lane goes dark on deploy**, because none has billing credentials yet | automated: ships behind `release_ui_governance_billed_cost_enabled`; the lane must read `no_billing_credentials` with its sentence, never `0` and never a stale figure. Existing customers are asked for the billing grant, they are not silently degraded |
| Spend-lane reason states (§21.3) | yes | medium (customer-visible money) | automated: the four-reason table-driven test + the no-currency-amount assertion; behind the existing flag |

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
) ENGINE = ReplacingMergeTree(Version)   -- via the CLICKHOUSE_ENGINE_REPLACING_PREFIX
                                         -- envsub in the real migration, never a bare literal
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
**Every Copilot connection that exists today loses its spend figure the
day §21 ships** — none of them carries billing credentials, so each
lands on `no_billing_credentials` until its owner grants the finance
role. That is the intended trade (a correct blank beats a figure read
with the wrong permission), but it is a visible regression for existing
users and needs the flag and a prompt, not a silent deploy (Gates).
Customers now have two Azure grants to obtain rather than one, and the
second one has a different approver — the reason it is worth doing is
also the reason it is slower to adopt.

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
| LWQL org-wide cost surface (§17) — own design pass, wave 2+ | deferred |
| Registry-final permission verb names (§18) | implementation PR |
| Key-to-bill mapping schema shape (§7) — column vs join table on `IngestionSource` | wave-2 implementation |

## Revisions

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
