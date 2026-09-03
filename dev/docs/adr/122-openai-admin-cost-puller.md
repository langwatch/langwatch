# ADR-122: OpenAI spend is pulled from the Admin cost report, attributed to the person and key on the row

**Date:** 2026-08-26

**Status:** Accepted

**Builds on:** ADR-088 (pulled usage becomes a priced, provider-agnostic
event under a restatement key that excludes cost — every decision there
stands; this ADR adds the second provider and the first per-person
attribution). ADR-088 Decision 13 supplies the identity principle this
follows.

**Related:** #7579 (the defect this replaces), langwatch#6977 (the
cents-vs-dollars class of bug this must not repeat), #6551 (named-person
attribution, still deferred).

> **One line:** a new **`openai_admin`** puller reads **`/v1/organization/costs`**
> grouped by **project, line item, user and API key**, and carries the
> **provider's raw user id and key id** onto the audit row — the money is
> the provider's own **dollars**, never converted, and the person is
> **never resolved at pull time**.

## Context

The shipped `openai_compliance` source cannot run and never has. Its
validator requires a `region` the form does not collect
(`openaiCompliance.puller.ts:88-90` against `inventory.tsx:1808-1833`), so
every save throws — which is also the proof no configured row exists
anywhere. Behind that, it polls S3 for a file OpenAI does not write, looking
for a per-event record shape OpenAI does not produce. It was written from
the Copilot Studio template; its own header still cites that spec. Full
diagnosis in #7579.

What OpenAI actually exposes is a **bucketed cost report**: daily buckets,
each holding grouped result rows. Unlike Anthropic's cost report — which
groups only by workspace and description — **OpenAI's carries
`user_id`, `user_email` and `api_key_id` on every row**. The identity is
already there. No directory call is needed to attribute spend to a person,
which is what makes this ADR possible at all.

Forces:

- ADR-088 Decision 5 keys restatement on **dimensions with cost excluded**,
  so a corrected bucket replaces rather than adds. That machinery is what
  makes a re-pull safe, and what makes a careless write destructive.
- ADR-088 Decision 4 attributes at **org/team**, with project deferred, and
  defers named-person attribution behind #6551.
- `NormalizedPullEvent` is the contract every adapter implements and is
  exported from `pullers/index.ts`. Extending it is a published-contract
  change, which is what routed this decision here rather than straight to
  implementation.

### Prior art read before deciding

- `dev/docs/adr/088-pulled-usage-reporting-record.md` — the governing ADR.
- `specs/governance/pulled-usage-cost-reporting.feature` — 11 scenarios,
  provider-agnostic, **none covering per-user or per-key attribution**.
- `services/pullers/anthropicAdmin.puller.ts` — the same bucket + group-by
  shape, and the template followed here.
- `services/pullers/pulledUsageRecord.ts` — the hint contract and
  `restatementKeyFor`.
- `services/pullers/databricksGenie.puller.ts:2566-2601` — the only shipped
  per-person attribution, which resolves through SCIM at pull time. OpenAI
  needs none of that.

## Decision

**1. One adapter, cost report only.** `openai_admin` pulls
`GET /v1/organization/costs` and nothing else. The eight `/usage/*`
endpoints are not pulled: the cost report already carries the identity and
real dollars, and the usage surface demonstrably under-reports — it returns
zero rows for image generation across windows the cost surface bills. A
source that pulled both would record the same spend twice, and ADR-088
Decision 6 defers the supersede rule that would let them coexist.

**2. The dimension set is `project_id`, `line_item`, `user_id`,
`api_key_id`, and it is locked.** These four are both the request's
`group_by[]` and the restatement key's coordinates. Reshaping the set later
re-keys every row already written and records the same spend a second time,
so it is fixed at the first pull and changing it is a new revision of this
ADR, not an edit.

One exception, and it is bounded: below the provider's key-grouping floor
`api_key_id` is unavailable, and those rows carry the remaining three
coordinates (Decision 8). A given bucket's map is stable — it is read with
one shape or the other, never both — because below-floor buckets are read
once during the forward backfill and Decision 9's re-read window never
reaches back that far.

**3. Money is dollars and is never converted.** `amount.value` is a JSON
number denominated in **US dollars**. Anthropic's equivalent field is
_cents in a decimal string_ and its adapter shifts the decimal
(`anthropicAdmin.puller.ts:401`). Porting that here would report **100× the
real spend**. Nothing in this adapter divides by 100, and the test suite
pins the figure end to end.

**4. `costStatus` is `estimate`, never `exact`.** It is not established that
this endpoint equals the invoice, and the provider's own cost and usage
surfaces already disagree with each other. `provider_reported` says the
number is theirs; `estimate` says we do not claim it is the bill.

**5. A bucket read that yields no row emits no usage hint.** Never
`costUsd: "0"`. The restatement key excludes cost by design, so a zero
written with a later `observedAt` wins `argMax` and **erases a confirmed
figure**. Omitting the hint entirely leaves the ledger untouched while the
audit row still lands — `buildPulledUsageRecord` returns null for
audit-only events, which is the mechanism that makes this safe. This is the
general hazard recorded against the Genie warehouse-cost work; it is
restated here because it is easy to reintroduce and silent when wrong.

**6. Identity rides the event as raw provider ids, in the extras bag.**
`actor` carries `user_email`. The raw `user_id` and the `api_key_id` ride in
`extra`, which `pullerWorker.ts:587` spreads into `metadata.extension` —
exactly the shape `databricksGenie.puller.ts:2596-2602` already ships for
per-person attribution. **`NormalizedPullEvent` does not change**, so no
published contract moves and no sibling adapter is touched.

Populating the real `ActorUserId` column was considered and rejected. It is
hardcoded to `""` for every puller (`pullerWorker.ts:602`), and the one
surface named to justify filling it — `activityMonitor.service.ts:354` —
reads `actorEmail || actorUserId || actorEnduserId`. OpenAI sends
`user_email` on **every** row, so the email always wins that `||` and the
column write would never be read. A published-contract change for a value
nothing observes is cost with no benefit.

This follows ADR-088 Decision 13's principle — write the provider's raw id,
resolve the person later, never call a directory at pull time. OpenAI
satisfies it with zero lookups. Decision 13's own citations are broken and
are recorded in Assumptions below rather than fixed here.

**7. Spend attribution stays out of the ledger.** No user or API-key column
is added to `PulledUsageObserved`. `readPulledUsageTotals` has only test
callers, so per-person spend has no production reader to serve; and both
identifiers already reach the restatement key through the hint's
`dimensions` map, so nothing is lost by waiting. Adding a column now would
be an event-sourcing schema change in service of no screen.

**8. Below the API's key-grouping floor, the key dimension is dropped, not
the window.** `group_by=api_key_id` is refused before an epoch the provider
names in a 400. The adapter detects that specific rejection — `param` of
`"start_time"` **and** `code` of `"invalid_request_error"` together, a pair
no other 400 from this endpoint produces — and retries the identical window
with only `user_id` in `group_by[]`. The API refuses any multi-dimension
request that includes `api_key_id` below the floor — not just the key
dimension, but any request carrying it alongside others. Falling back to
`user_id` alone means **per-person attribution survives for the whole
history**; project and line-item detail is lost alongside the key below the
floor, where those rows carry a single-dimension map.

Clamping the window forward to an epoch parsed out of the error prose was
rejected. It discards every day below the floor rather than partially
attributing it, and it makes an English sentence load-bearing: a reworded or
localized message leaves the parse with no fallback, and the framework does
not advance a cursor on error, so the source would retry the identical
failing request forever. Dropping a dimension needs no regex and cannot
wedge.

A bucket below the floor is read once, during the forward backfill, and is
never revisited — Decision 9's re-read window is measured from the present
and does not reach it. So no bucket carries a one-dimension map on one run
and a four-dimension map on another.

**9. Restatement re-reads a trailing window.** Each run fetches from
`watermark - RESTATEMENT_LOOKBACK_DAYS`, not from the watermark, so a bucket
the provider corrects inside that window replaces its earlier figure through
the restatement key. The watermark itself advances as
`max(currentWatermark, lastBucketStart)` and never moves backwards.

Forward-only — each bucket read once, matching Anthropic — was considered
and rejected. It guarantees a provider correction never reaches the ledger
and leaves the restatement machinery inert in steady state. It is also
**undetectable here**: `readPulledUsageTotals` has no production caller, the
spend dashboards read `trace_summaries` which this adapter never writes, and
the spend-spike evaluator reads `governance_kpis` fed only by trace events.
A wrong figure would be corrected by nobody and noticed by nothing. Three
extra daily buckets per run buys the only correction path that does not
require an operator to spot the error first.

The operator's backfill lever still exists, and is now specified rather than
asserted: the cursor stores a query identity over the adapter, report,
group-by set and configured `startingAt`; a changed identity discards the
stored page token and restarts; a widened `startingAt` re-reads from the
earlier of the stored watermark and the new start. That is the discipline
`anthropicAdmin.puller.ts:178-273` implements as `queryIdentity`,
`parseCursor` and `staleCursorRestart`, duplicated here per Decision 11.

**10. Two sources on one organization are a documented warning, not a
guard.** Two `openai_admin` sources in one org carry different
`ingestionSourceId`s, therefore different restatement keys, therefore the
same spend twice. The catalog blurb says not to, exactly as Anthropic's
does. The exposure is real and is inherited, not introduced; a uniqueness
guard belongs on every provider adapter at once, and building it only here
would hide the gap elsewhere.

**11. Standalone adapter, no shared base.** `openai_admin` duplicates
`anthropicAdmin`'s cursor discipline rather than extracting a base class.
Two instances are a coincidence, not a pattern, and the wire shapes already
diverge on money units, timestamp format, page-token binding and a
retention floor Anthropic has no equivalent of. An abstraction built at n=2
is shaped like its first caller. Revisit at the third provider.

**12. `openai_compliance` is deprecated in place, still listed.** It stays
registered, stays in the catalog array, and stays **visible** in the picker
behind a `deprecated` badge that disables it for new sources. Hiding it was
rejected: `ingestionSourceCatalog.unit.test.ts:27-31` asserts the picker
offers every registered type, and
`specs/ai-gateway/governance/ingestion-sources.feature:28-38` promises a menu
"listing every supported source type". A disabled badge keeps both true and
still stops anyone choosing it. No backfill and no migration: no valid row
can exist, so there is nothing to repair.

## Constants

| Name                        | Value                                                  | Purpose                                                                                                                                                                                                                                                                       |
| --------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_BASE`                  | `https://api.openai.com/v1/organization`               | Admin API root. Not `api.chatgpt.com`, which is the Compliance API and answers 403 to an admin key.                                                                                                                                                                           |
| `COST_REPORT_BUCKET_WIDTH`  | `"1d"`                                                 | The only value the endpoint accepts (`1h` → 400, `Supported values are: '1d'`). Both a request parameter and a restatement dimension; the two must never diverge.                                                                                                             |
| `COST_GROUP_BY`             | `["project_id", "line_item", "user_id", "api_key_id"]` | Decision 2. Request parameter and cursor identity.                                                                                                                                                                                                                            |
| `PAGE_LIMIT`                | `180`                                                  | The API's ceiling. Above it the request is **rejected**, not clamped (`Invalid limit provided: 366. Limit must be less than or equal to 180.`). One page is ~6 months of daily buckets.                                                                                       |
| `RESTATEMENT_LOOKBACK_DAYS` | `3`                                                    | Decision 9. How far behind the watermark each run re-reads so a provider correction can land. A margin, not a measurement — OpenAI's restatement lag is unobserved, and the sibling adapter documents ~1 day for Anthropic. Costs three daily buckets on one request per run. |
| `MAX_PAGES_PER_RUN`         | `20`                                                   | Matches the sibling. At 180 buckets a page this bounds a run at ~10 years, so it is a runaway guard, not a throttle.                                                                                                                                                          |
| `REQUEST_TIMEOUT_MS`        | `30_000`                                               | Matches the sibling.                                                                                                                                                                                                                                                          |
| `DEFAULT_SCHEDULE`          | `"0 * * * *"`                                          | Hourly. Daily buckets do not reward finer polling.                                                                                                                                                                                                                            |
| `OPENAI_ADMIN_ADAPTER_ID`   | `"openai_admin"`                                       | Registry id, persisted in `pullConfig.adapter`.                                                                                                                                                                                                                               |

## Invariants

| Invariant                                              | Meaning                                                                     | How the design satisfies it — test anchor                                                                                       |
| ------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| No division by 100                                     | A provider dollar reaches the ledger as that many dollars                   | A captured row's `amount.value` is asserted equal, to the digit, at the ledger boundary                                         |
| No float round-trip on money                           | Sub-cent figures keep every digit                                           | `amount` parsed as `string \| number` and stringified once; a string input survives byte-identical                              |
| A costless read writes no money                        | A missing row never overwrites a present one                                | Unit test: a bucket whose row vanished emits an event with **no** `pulled_usage` key, and `buildPulledUsageRecord` returns null |
| Re-pulling an unchanged window records nothing new     | At-least-once delivery is free                                              | Same window pulled twice; ledger row count unchanged                                                                            |
| Identity reaches the audit row                         | Attribution is visible where a surface already reads it                     | OCSF row asserts `ActorEmail` = the row's email, and `metadata.extension.actorUserId` / `.apiKeyId` = the row's raw ids         |
| The watermark never moves backwards                    | A re-read window, or a page returned out of order, must not rewind progress | Unit test: a response whose last bucket precedes the stored watermark leaves the watermark unchanged                            |
| A corrected bucket replaces, never adds                | Restatement is the whole point of the re-read window                        | Same window pulled twice with a changed `amount.value`; the ledger shows the new figure once, and the row count is unchanged    |
| Below the floor the day survives, only the key is lost | A 400 on key grouping must not cost history                                 | Unit test: a floor 400 triggers one retry with `user_id` only, and the resulting rows still carry `user_id`                     |
| The cursor never replays a token under a changed query | `next_page` is bound to its query and 400s otherwise                        | Query identity stored in the cursor; a config edit drops the token rather than replaying it                                     |
| A partial window never reports as complete             | A fetch failure must not advance the watermark                              | Transport failure returns the prior cursor unchanged and `errorCount: 1`                                                        |
| The dimension set is stable                            | A restatement finds the figure it corrects                                  | Dimension keys asserted against a frozen list; adding one fails the test                                                        |

## Assumptions

| Assumption                                                               | What breaks if false                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_id` identifies the **caller**, not the API key's owner             | Every row is attributed to whoever minted the key rather than who spent. **Tested and unresolved:** across all captured rows every key maps to exactly one user, but the whole dataset carries a single `user_id`, so the discriminator cannot fire. Consistent with both readings; proves neither.                                  |
| OpenAI restates a bucket **in place**, under the same coordinates        | A correction arrives as a new row beside the old instead of replacing it, and the period double-counts. Never observed. Decision 9's re-read window is what makes this load-bearing: it is the mechanism that carries a correction to the ledger, and it only works if the corrected row keeps its coordinates.                      |
| The `api_key_id` floor is a property of the API, not of one organization | Nothing — Decision 8 reacts to the rejection rather than predicting it, so a per-tenant floor is handled identically. Recorded because it decides whether the retry can ever be removed.                                                                                                                                             |
| Buckets arrive in ascending order, one per day with no gaps              | Nothing. Observed over 264 consecutive buckets — strictly ascending within and across pages, every gap exactly 86400s, so a quiet day still returns its bucket and the watermark keeps moving. **Deliberately not relied on:** the watermark takes `max()` rather than the last element, so ordering being unguaranteed cannot hurt. |
| A row that disappears from a re-read bucket means _no longer billed_     | Nothing breaks — Decision 5 makes the vanished row keep its last known value rather than zeroing. Stated so the behaviour is chosen, not accidental.                                                                                                                                                                                 |
| ADR-088 Decision 13's read-time identity stack will eventually exist     | Nothing in this ADR depends on it. Recorded because D13 cites **ADR-094**, which is _simulation-execution-on-process-manager-substrate_, not identity — the identity ADRs are 101 and 115 — and names `ACTOR_ID_KIND_BY_PROVIDER`, which **appears in no source file**. The stack is unbuilt and the citation is wrong.              |

## Gates

| Path                                                | Reversible?                                         | Blast radius              | Required gate                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cost figure → ledger                                | No — `argMax` replacement destroys the prior figure | Money                     | Human review, plus the no-division and costless-read tests above. A dollar figure is asserted end to end against a captured payload, not a hand-written one.                                                                                                                                                                                                                 |
| Provider identity ids leaving for third-party SIEMs | No — an export is a send                            | Privacy                   | Human review. `governanceOcsfEvents.clickhouse.repository.ts:236,284` exports `RawOcsfJson` to whatever SIEM an org has wired, and `raw_payload` is **required** on every pull event (`pullerAdapter.ts:96`), so the provider's ids egress by construction. Not introduced here — Anthropic and Genie already do it — but named so it is a decision rather than an accident. |
| `openai_admin` `pullConfig` shape                   | No — persists in customer rows                      | Small (no row exists yet) | Human review of the schema. Validated at create time by `validateConfig`.                                                                                                                                                                                                                                                                                                    |
| `openai_compliance` badged deprecated               | Yes                                                 | Small                     | Automated: the two existing catalog tests must stay green **unchanged** — the picker still offers every registered type (Decision 12).                                                                                                                                                                                                                                       |
| The trailing re-read window                         | Yes — read-only, bounded by a constant              | Small                     | Automated: the restatement invariant above, plus a test that the watermark does not rewind.                                                                                                                                                                                                                                                                                  |
| Live pull against the real Admin API                | Read-only                                           | None                      | Required before merge. A fixture alone has never caught a wire-shape error in this codebase.                                                                                                                                                                                                                                                                                 |

## Schema

**No migration, and no contract change.** `NormalizedPullEvent` is untouched
(Decision 6): identity travels in the existing `extra` bag, which the worker
already spreads into `metadata.extension`. `ActorUserId` stays the empty
string, as it is for every puller today.

```ts
// What the adapter puts in the existing `extra` record. Raw and unresolved:
// ADR-088 D13 — the person is a read-time join, never a pull-time directory
// call. `apiKeyId` is carried because it outlives the key: spend accrues
// against keys that have since been deleted, and the id is all that is left
// to join on.
extra: {
  actorUserId: result.user_id,
  apiKeyId: result.api_key_id ?? "",
  projectId: result.project_id ?? "",
  lineItem: result.line_item ?? "",
}
```

```ts
// The persisted pullConfig shape. `report` is a single-value enum rather
// than a bare constant so a second report can be added later without
// re-keying the rows this one wrote.
{
  adapter: "openai_admin",
  report: "cost",
  startingAt?: string,   // ISO instant; the backfill origin
  schedule: string,      // default "0 * * * *"
  credentials: { token } // Admin API key, encrypted at rest
}
```

## Rejected alternatives

- **Pull the eight `/usage/*` endpoints** — the usage surface returns zero
  rows for spend the cost surface bills; pulling both double-counts.
- **Port `centsToUsd`** — reports 100× the real figure. The single most
  expensive mistake available here.
- **`costStatus: "exact"`** — claims the invoice without evidence, from an
  endpoint whose sibling surface already contradicts it.
- **Emit `costUsd: "0"` for a vanished row** — erases confirmed spend.
- **Add user/API-key columns to `PulledUsageObserved`** — an event-schema
  change serving no reader.
- **Resolve `user_id` to a LangWatch person at pull time** — bakes a
  resolution into an immutable record, and #6551 defers it.
- **Clamp the window forward at the key-grouping floor** — discards history
  to protect a dimension, and makes a parse of English prose load-bearing
  with no fallback when it fails. Against a hardcoded epoch it is worse
  still: silently stale if the floor rolls.
- **Forward-only restatement, matching Anthropic** — guarantees a provider
  correction never reaches the ledger, in a product where nothing would
  notice. Rejected in Decision 9.
- **Extend `NormalizedPullEvent` and populate `ActorUserId`** — a
  published-contract change whose value no surface reads, because
  `actorEmail` always wins the `||` that would have exposed it.
- **The declarative `http_polling` adapter** — the framework's documented
  default, and genuinely unusable here: its `eventMapping.extra` is a flat
  `z.record(z.string())` that cannot build the nested `dimensions` map the
  usage hint needs, its 4xx handling is fail-fast with no access to the
  error body Decision 8 reads, and it offers no watermark or query identity
  beyond an opaque page token.
- **Hide `openai_compliance` from the picker** — breaks two passing catalog
  tests and contradicts a spec scenario promising every supported type is
  listed. A disabled badge achieves the same end.
- **A uniqueness guard on duplicate sources** — belongs on every adapter,
  not this one alone.
- **Extract a shared bucket-report base** — n=2 is a coincidence, and the
  wire shapes already diverge on four axes.
- **Delete `openai_compliance`** — deprecation costs nothing and keeps the
  completeness guard intact.

## Consequences

**Positive.** OpenAI spend becomes visible and is attributed to a named
person and a specific key, with no directory integration — the first
attribution of its kind that costs no extra request. Per-person attribution
survives the provider's key-grouping floor, so the full history is
attributed rather than truncated. A bucket the provider corrects inside the
lookback window reaches the ledger. One page covers six months, so a
backfill is a handful of requests. No published contract changes, so no
sibling adapter carries risk from this work.

**Negative.** Per-person **spend** remains invisible until something reads
the ledger; only per-person **activity** lands on a surface today —
`readPulledUsageTotals` still has no production caller, so this ADR ships
correct numbers into a table nothing aggregates. A correction arriving later
than `RESTATEMENT_LOOKBACK_DAYS` is still missed, and that constant is a
margin rather than a measurement. Two sources on one organization still
double-count — and so does **deleting and recreating** one source, because
`ingestionSourceId` is a restatement-key coordinate, so every re-pulled
bucket lands beside the old rows instead of replacing them. Whether
`user_id` is the caller or the key's owner is unresolved, so the headline
attribution claim carries an untested assumption. Key-level detail is absent
below the provider's floor.

The provider's user id, email and key id are exported to any third-party
SIEM the organization has wired up, because `raw_payload` is required on
every pull event and the whole raw row ships inside `RawOcsfJson`. That is
inherited framework behaviour, not new here, and it is why Decision 6
changes nothing about exposure.

**Neutral.** `openai_compliance` stays registered, listed and inert. The
adapter duplicates cursor logic a third provider may justify factoring out.

## Open questions

- **Is `user_id` the caller or the key's owner?** Owner: whoever next has
  an organization with two spenders sharing one key. Settles the headline
  attribution claim.
- **Does OpenAI restate a cost bucket in place, and within how many days?**
  Requires observing a real correction. Both halves of Decision 9 depend on
  it: in-place decides whether a correction replaces or duplicates, and the
  lag decides whether `RESTATEMENT_LOOKBACK_DAYS = 3` is enough.
- **Is the `api_key_id` floor fixed or rolling?** Decision 8 is correct
  either way; the answer decides whether the retry can later be removed.
- **Nothing aggregates the pulled-usage ledger.** `readPulledUsageTotals`
  has test callers only, so per-person spend has no reader and no
  reconciliation job compares these figures to an invoice. Owner
  unassigned; it is the gap that makes a wrong figure undetectable.
- **Why does the cost surface bill image generation that `/usage/images`
  reports zero rows for?** Out of scope here; recorded in #7579.
- **A uniqueness guard across all provider adapters** — owner unassigned.

## Revisions

- **v1 (2026-08-26) — initial proposal.** Framed against the #7579
  diagnosis. Four forks locked in one round: the key-grouping floor is
  **clamped from the error, not a constant**; restatement is
  **forward-only, matching Anthropic** — taken against the recommendation
  of a trailing re-read window, with the consequence recorded in Decision 9
  rather than softened; duplicate sources get a **warning blurb only**,
  matching the sibling; the adapter is **standalone**, no shared base at
  n=2. Grounded in four live probes run before any code: `end_time` is
  optional and must be omitted (a moving one invalidates every page token),
  `bucket_width` is genuinely read (`1d` only), the `limit` ceiling is
  **180 and rejects rather than clamps**, and `group_by=api_key_id` is
  refused before a fixed epoch with a 400 naming it — probed to the second.
  One earlier finding was **corrected**: the reference suite recorded
  `limit` as clamping silently to 31, which was confounded by a 31-day test
  window. One assumption was **tested and left open**: the captured data
  cannot discriminate caller from key-owner semantics for `user_id`,
  because a single user accounts for every row. Captain: Sergio Esteban.

- **v2 (2026-08-26) — accepted after adversarial review.** Five independent
  reviewers read v1 against the codebase; all five refuted it. **Three
  locked forks were reopened and reversed.** Decision 8 now **drops the
  `api_key_id` dimension** below the provider's floor instead of clamping
  the window forward — the reviewers found the clamp discarded history to
  protect a dimension, and that a failed prose parse would wedge the source
  permanently, since the framework never advances a cursor on error.
  Decision 9 now **re-reads a trailing three-day window** instead of being
  forward-only; four reviewers independently reached the same finding, and
  one established the decisive fact: no surface in the product reads the
  pulled-usage ledger, so a wrong figure would be corrected by nobody and
  noticed by nothing. Decision 6 now carries identity in the **existing
  `extra` bag** rather than extending `NormalizedPullEvent` — the column it
  would have filled is unreadable behind `actorEmail ||`, which OpenAI
  populates on every row, and `databricksGenie.puller.ts:2596-2602` already
  ships the extras shape. Decision 12 now keeps `openai_compliance`
  **visible with a disabled badge**: hiding it would have broken two passing
  catalog tests and a spec scenario promising every supported type is
  listed.

  Four gaps were closed without reopening a fork: the watermark takes
  `max(watermark, lastBucketStart)`, retiring an unstated dependence on
  bucket ordering; the floor 400 is identified by `param` **and** `code`
  together, since a bare `param` check would misread the limit rejection;
  `queryIdentity` / `parseCursor` / `staleCursorRestart` are specified here
  rather than deferred, because Decision 9's operator lever was asserted
  without a mechanism; and delete-and-recreate is named as a
  ledger-doubling hazard, since `ingestionSourceId` is a restatement-key
  coordinate.

  Three live probes ran during review. The 400 envelope was mapped across
  six rejection shapes, establishing the `param`+`code` discriminator and —
  from a deliberately bogus `group_by` value — confirming the endpoint's
  dimension enum is exactly the four in Decision 2. Bucket ordering and
  density were measured over 264 consecutive buckets across two pages:
  strictly ascending, every gap exactly one day, page two starting exactly
  one day after page one ended. That observation is recorded as **not
  relied upon**. Two findings survived every attack unchanged: money-unit
  handling, and the costless-read guard. Captain: Sergio Esteban.
