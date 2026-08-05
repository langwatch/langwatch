# ADR-071: a mutable storage anchor — take it out of the list read now, freeze it in the writer next, and target platform accept time when we re-key

**Date:** 2026-07-28

**Status:** Accepted

**Corrects:** [ADR-056](./056-coding-agent-pipeline-session-aggregate.md) §"Engine / partition / retention" — the decision to lead the sort key with `StartedAt` and to anchor both the partition and the TTL on it. ADR-056 knew the column moved and priced only the *dedup* cost; it did not price the partition, the TTL, or the range-filtered list read.

**Scope:** the fix and the freeze are `coding_agent_sessions`. **The anchor finding is systemic** — `trace_analytics` (00039) and `evaluation_analytics` (00041) make the same mistake under the column name `OccurredAt`, and are recorded here as same-class instances so nobody re-derives it. No table is re-plumbed and no migration ships.

> **Amendment (2026-07-29) — sequencing step 3 has landed for `trace_analytics` first.** The scope sentence above, and every statement in this ADR that `trace_analytics` is recorded-but-unchanged (notably *"It re-plumbs nothing and adds no migration"* below, the "recorded, not changed here" list in References, and *"which anchor on a moving column too"*), are **historical for that one table**. `trace_analytics.OccurredAt` now carries a frozen, first-observed anchor (`storageAnchorMs`), its span timing baseline moved to a new `EarliestSpanStartMs` column (migration **00061**), and the fold's projection stamp moved to `2026-07-29`.
>
> It went first because it had a consequence `coding_agent_sessions` does not: only spans set that column, so a log-only trace (Claude Code / Codex "Path B") committed at `new Date(0)` — partition `196952`, TTL deadline already past — and was reaped, after which every delivery refolded the aggregate's whole history.
>
> **The stamp move is not a refold trigger, and that is load-bearing.** The predecessor stamp (`2026-07-27`) is *decoded*, not refused: on a pre-split row `OccurredAt` is `min(span start)`, which is simultaneously a valid anchor (it is what the row is already partitioned and TTL'd on) and the correct timing baseline (it is what the new column was split out to carry), so both fields are read off that one column and the row heals in place. Refusing it instead would have forced the whole population to rebuild from `event_log`, and a rebuild re-derives the anchor — so the change whose premise is *"an anchor is written once"* would have opened by re-anchoring every trace it touched, reintroducing consequences 1-3 at population scale. For the same reason this does **not** reset ADR-066's `refoldOnStoreMiss` retirement clock: no new refold population is created.
>
> Two honest qualifications to that. **Forward only:** during a rolling deploy, pods still on the previous build refuse the new stamp (their gate is a bare equality) and refold each row a new pod wrote. That is the ordinary cost of any stamp bump, bounded by the deploy window rather than by the size of the table, and it is why the decode exists on the forward path where the population is. **One existing row does move:** the anchor is validated on every write, not only when first frozen, so a row whose committed `OccurredAt` is more than a day ahead of fold time fails the new bound and is rewritten at fold time. That is a partition move on an existing row, and it is the intent — such a row was filed in a future partition with a TTL deadline to match, and would have outlived its tenant's retention. It converges after that one write.
>
> That is this ADR's rules applied unchanged, not a new decision: the anchor is first-observed rather than `min`, the displayed/derived business value is a separate column, and the target anchor is still platform accept time behind the human sign-off recorded in sequencing item 6. Two deviations are worth naming: the write-time fallback for a state carrying no business time at all is the projection's own `CreatedAt`, which item 6 warns against as re-stampable — accepted here because it applies only where there is nothing else, and validated at every step so the column can never be the epoch; and the anchor is bounded on its future edge (a producer-supplied time more than a day ahead of fold time is refused), because freezing is exactly what would otherwise make one bad producer timestamp permanent. `coding_agent_sessions` step 3 and `evaluation_analytics` are unchanged and still pending. **`trace_summaries` was fixed independently in migration 00067** — see the inventory note below.

**Relates to:** [ADR-066](./066-projection-clickhouse-cached-store.md) (the read-back store that writes this row, and its `MetricSeries` step 2), [ADR-068](./068-windowed-clickhouse-reads.md) (windowed reads — the list read here is the counter-example that motivates the rule, and its bound-then-filter shape is how an accept-time anchor still answers business-time questions), [ADR-034](./034-event-sourced-analytics-materialization.md) (the RMT-plus-IN-tuple materialisation shape).

## Context

`coding_agent_sessions` overloads **one mutable column** with three storage jobs:

```sql
ENGINE = ReplacingMergeTree(UpdatedAt)      -- migration 00051:192
PARTITION BY toYearWeek(StartedAt)          -- 00051:193
ORDER BY (TenantId, StartedAt, SessionId)   -- 00051:194  (the RMT dedup key)
TTL IF(_retention_days > 0, toDateTime(StartedAt) + toIntervalDay(_retention_days), …) DELETE  -- 00051:195
```

`StartedAt` is not stable. The fold takes the **minimum** business time it has ever seen for the session:

```ts
// codingAgentSession.foldProjection.ts:262-267
// The session starts when its earliest signal does. Spans refine this
// below with their own start time, which can predate arrival order.
startedAtMs:
  state.startedAtMs === 0
    ? data.occurredAt
    : Math.min(state.startedAtMs, data.occurredAt),
```

Every fold delivery can move it, and for a live aggregate that reads its own state back it only ever moves **backwards** (it can also be re-stamped *forwards* on a read-back miss — see "What 'freeze' means concretely" below, which is why no bound on it is safe in a dedup scope). So the dedup key, the partition key and the TTL anchor are all a moving target, and each moves for a different reason than the others care about.

ADR-056 chose this deliberately, and its own migration comment says so — *"the engine only collapses rows sharing the FULL sort key, and `StartedAt` can shift when an earlier signal arrives late, so every read MUST dedup by `(TenantId, SessionId, max(UpdatedAt))`"* (00051:38-41). That was a correct diagnosis of **one** of the four consequences. This ADR prices the other three.

### Consequence 1 — dedup: orphaned versions, but fewer than you would guess

A ReplacingMergeTree collapses only rows sharing the **full sort key**. When a version lands with a smaller `StartedAt`, its sort key differs from its predecessor's, so the engine treats the two as unrelated rows and never collapses them. The superseded version survives until TTL.

**The bound is narrower than "every write is orphaned", and this matters for the decision.** Versions sharing a `StartedAt` *do* collapse normally. A session is only orphaned across a *change*, so the residue per session is **O(distinct `StartedAt` values)** — the number of times a new earliest signal arrived — not O(writes). For telemetry arriving roughly in order that is one or two rows; it grows only for sessions whose earliest span lands after many later ones.

So: real amplification, on a table that is an aggregate (one row per session, no bodies, every column a scalar or bounded array — 00051:19-31). Not a capacity threat on its own.

### Consequence 2 — partitioning: the orphans that can never collapse

Merges are per-partition. If a backwards shift crosses a `toYearWeek` boundary, the old and new versions land in **different partitions**, and no merge — including `OPTIMIZE … FINAL` — can ever collapse them. They are permanent until TTL.

This needs a session whose start moves across a week boundary, so it is rarer than consequence 1. It is also strictly worse when it happens, because it removes the escape hatch.

### Consequence 3 — TTL: the deadline moves *towards* the row

`TTL toDateTime(StartedAt) + toIntervalDay(_retention_days)`. Moving `StartedAt` backwards moves the row's delete deadline **closer**, and does so *after* the row was written. Worse, the ordering is exactly wrong: the **true-latest** version has the **smallest** `StartedAt`, so it is the one with the **earliest** deadline. An orphaned older version outlives the version that supersedes it.

Near the boundary, a background merge deletes the true-latest row and leaves a stale one behind, and the read then returns the stale one — a silent regression to older totals, not a missing row.

**This is not hypothetical.** It is the root cause of the CI flake fixed in PR #6127: a fixture backdating `StartedAt` by exactly `retentionDays` parked the row on the TTL boundary, and a background merge deleted the true-latest version. It was proven with `OPTIMIZE TABLE … FINAL`. In production the fuse is the retention period (308 days by default, 00051:190), which is why it has not been seen there.

### Consequence 4 — a wrong answer at any age, and the one this change fixes

The claim that "reads still return the right row because the repository dedups by `(TenantId, SessionId) + max(UpdatedAt)`" held for the **point** read and failed for the **list** read.

The point read is safe *because it was deliberately built to be*. Its inner dedup subquery is unwindowed (`findLatestRecord` in `coding-agent-session.clickhouse.repository.ts`), and the docblock above it explains exactly why: windowing it too would let a session whose latest version drifted outside the window read back as a stale in-window version.

`findManyRecent` applied the same `StartedAt` range filter to **both** scopes — outer *and* inner:

```sql
AND (TenantId, SessionId, UpdatedAt) IN (
  SELECT TenantId, SessionId, max(UpdatedAt)
  FROM coding_agent_sessions
  WHERE TenantId = {tenantId:String}
    AND StartedAt BETWEEN … {from} AND … {to}   -- ← the mutable column, in the dedup scope
  GROUP BY TenantId, SessionId
)
```

So when a session's latest version backdated `StartedAt` **out** of the requested window while an older version remained **inside** it, the subquery computed `max(UpdatedAt)` over the older versions only, and the list rendered the session **at a start time it never had, with stale totals**. No fallback caught it: the result is non-null and looks fine.

This was reachable without any TTL involvement and without a week boundary. A day-bounded view is enough: a session whose first telemetry to arrive is a log from 00:10 today writes `StartedAt = today 00:10`; the 23:50 span from yesterday then arrives and moves it to yesterday, outside "today" — and today's list kept showing the first version forever.

#### Fixed here, not deferred

The `StartedAt` bound is **removed from the inner dedup subquery**, which now carries only `TenantId`. The outer scope keeps its full `BETWEEN`, so the read still prunes partitions — but it now judges the **true** latest version rather than whichever version the window happened to admit:

- latest **inside** the window → the dedup resolves it, the outer admits it: correct row, correct totals;
- latest drifted **below** the window (the bug case) → the dedup resolves it, and the outer `BETWEEN` then excludes it. The session **leaves the window** instead of rendering stale — which is the honest answer, because its start time is no longer in the period that was asked for;
- latest **after** the window → excluded, as before.

**No bound belongs on the dedup scope, not even an upper one.** The tempting half-fix keeps `StartedAt <= {to}`, reasoning that the latest version always holds the smallest value because the fold takes a `Math.min`. That reasoning is wrong, for the same reason recorded under "What 'freeze' means concretely" below: a read-back store miss re-runs `init()` and re-stamps `startedAtMs` from the next event's `occurredAt`, which can be **larger** than the value already persisted. "Latest is smallest" does not hold, so any bound on the dedup scope can hide the true latest.

**The cost, stated plainly.** The inner subquery no longer prunes to the window, so it scans this tenant's sessions across partitions instead of the window's weeks. It reads only sort-key columns plus `UpdatedAt` — no heavy columns — and groups to one row per session, so it stays a compact scan, and the outer scope still prunes. It is nonetheless a real cost increase on this read, and it is what a correct answer costs while the anchor moves. Sequencing step 3 below — freezing the writer — removes the cause and lets the pruning bound come back to the dedup scope safely.

**And measured, not just stated.** `coding_agent_session_list_read_duration_milliseconds{table,outcome}` times this read, so "the compact scan is acceptable" stops being a claim and becomes a series. `outcome` is `hit` / `empty` / `error`; the `empty` bucket is the useful one for this question, because an empty window still runs the whole unwindowed dedup scan while materialising nothing in the outer `SELECT *`, so it isolates the scan's own floor from the cost of rendering rows. Labels stop at `table` and `outcome` — a tenant label on a one-row-per-session table would track the customer count, and per-tenant attribution belongs in the log line.

**Duration only, and why.** The query result carries no rows-scanned counter to record: `client.query()` resolves a `ResultSet` that exposes `response_headers` but no parsed summary, the ClickHouse client parses `X-ClickHouse-Summary` (`read_rows`, `read_bytes`) for `insert`/`command`/`exec` alone, and for a streaming `SELECT` those counters are complete only under `wait_end_of_query=1`. Rows *returned* is capped by the caller's limit and so says nothing about the scan, which is why it is not recorded as a stand-in. If rows-scanned is ever wanted here, it is a `system.query_log` question, not a client-side one.

Regression cover is in `coding-agent-session.clickhouse.repository.unit.test.ts`: its fake client executes *both* scopes off the SQL the repository emitted, so putting the range filter back into the dedup subquery makes the drifted session reappear with stale totals and fails the suite.

## Decision

**The correct end state is a dedup key with no mutable column in it — `ORDER BY (TenantId, SessionId)` — with a partition key and TTL anchor anchored on platform accept time rather than producer business time.**

That anchor choice is a **systemic finding, not a `coding_agent_sessions` one**: `trace_analytics` and `evaluation_analytics` have the same defect under the column name `OccurredAt`, verified below. Freezing a producer-supplied column is an improvement over letting it move, but accept time is what the invariant actually requires — see "Which column, if we ever do re-key".

**We are not migrating any of the three tables to get there.** Near term we fix the list read that returns a wrong answer today, and make `StartedAt` immutable in the writer; the re-key stays deferred behind named triggers, and adopts accept time whenever it happens.

The reasoning is that **all four consequences are caused by the column moving, not by which column is in the key.** Freeze the anchor at the source and every one of them stops for rows written afterwards — with no new table, no backfill, and no swap:

| Consequence | Fixed by re-keying the table? | Fixed by freezing the writer? | Fixed by the read change shipping here? |
|---|---|---|---|
| 1. Orphaned versions | Yes | Yes — versions share a sort key again, so RMT collapses them | No — storage residue, not a read |
| 2. Cross-partition orphans | Yes | Yes — every version of a session lands in one partition | No |
| 3. TTL deadline moves | Only if the anchor also changes | Yes — the deadline is set once | No |
| 4. List read returns a stale version | **No** — the list filters `StartedAt` because it is the partition key; a re-key alone leaves it mutable | Yes — no version can be in-window while another is out | **Yes — the dedup scope stops filtering on the moving column** |

Re-keying alone does not fix the consequence that actually bites. Freezing does, and it is the cheap half. The read change closes that one consequence **now**, at the cost of an unwindowed dedup scan, without waiting for either — and the freeze is what lets that scan go back to being pruned.

### What "freeze" means concretely

1. **`StartedAt` becomes first-observed, not minimum** — `state.startedAtMs === 0 ? data.occurredAt : state.startedAtMs`. It stops being business truth and becomes what it is already being used as: a **storage anchor** for partitioning, TTL and range pruning.
2. **A new, mutable `EarliestSignalAt` column carries the business truth** — the `Math.min` that `StartedAt` does today — and is what the session view and the list *display* and sort on. This is an additive `ALTER TABLE ADD COLUMN`, which ClickHouse does as a metadata change; it costs nothing like a re-key.
3. **The two differ by fold latency, not by session length.** `StartedAt` is the first signal *folded*; `EarliestSignalAt` is the earliest signal *observed*. For in-order telemetry they are equal. The gap is bounded by how out-of-order arrival gets, and only the anchor is affected — nothing a user sees moves.

The same honesty applies to both options: neither `StartedAt`-frozen nor any alternative column is *structurally* immutable, because a read-back miss re-runs `init()` and re-stamps (`abstractFoldProjection.ts:207-211`). It is immutable **for a live aggregate that reads back successfully**, which is the invariant ADR-066 already depends on everywhere else. A re-key would inherit exactly the same caveat, so it is not a reason to prefer one over the other.

### Which column, if we ever do re-key — and the finding that changes the answer

**The target anchor is platform accept time.** Freezing `StartedAt` remains the near-term step, but it is not the end state, and the reason only became visible once consequence 4 was traced to its cause.

#### The defect is not "the anchor is `StartedAt` rather than `OccurredAt`"

The obvious reaction to this ADR is that `coding_agent_sessions` picked an idiosyncratic column while the sibling analytics tables got it right. **They did not.** Both carry the same defect under a different column name. Checked, not assumed:

| Table | Anchor (partition + sort key + TTL) | How it is derived | Direction it moves |
|---|---|---|---|
| `coding_agent_sessions` (00051:192-195) | `StartedAt` | `min(state.startedAtMs, occurredAt)` — `codingAgentSession.foldProjection.ts:262-267` | backwards |
| `trace_analytics` (00039:189-192) | `OccurredAt` | was `min(state.occurredAt, span.startTimeUnixMs)` — `span-timing.service.ts:36-38`; **since the amendment above** it is `storageAnchorMs`, first-observed and frozen, projected at `traceAnalytics.foldProjection.ts:593` | **frozen per row** — see the caveat below |
| `evaluation_analytics` (00041:135-138) | `OccurredAt` | `LastEventOccurredAt`, i.e. `max(prev, event.occurredAt)` — `abstractFoldProjection.ts:235-238`, projected at `evaluationAnalytics.foldProjection.ts:252` | forwards |

**The `trace_analytics` caveat, stated rather than implied.** "Frozen" is a per-row guarantee, not a per-trace one, and it has exactly two exceptions.

Normally a committed row's anchor does not move: the read-back promotes the column's own value back into the fold, so what was written is what is written again. The **first** exception is the bounded future rewrite — the anchor is validated on every write, not only when first frozen, so a row whose committed anchor sits more than a day ahead of fold time fails the bound and is rewritten at fold time. That is a partition move on a committed row, and it is the intent: the row was filed in a future partition with a TTL deadline to match, and would otherwise outlive its tenant's retention. It converges after that single write.

The **second** is the anchor a *rebuild from `event_log`* derives if the committed row is gone — `refoldOnStoreMiss` re-runs `init()`, and first-observed depends on which contribution the replay reaches first, which need not be the one the live fold saw first. That path is reached only when the row is genuinely absent (reaped, or never written), where there is no prior value to contradict. It is deliberately NOT reached by the split itself: the pre-split projection stamp is decoded rather than refused, precisely so the transition does not rebuild — and therefore re-anchor — the whole population.

`span.startTimeUnixMs` and `event.occurredAt` are **producer-supplied**. Renaming the column fixes nothing.

**Inventory correction (2026-07-29, fixed 2026-08-02): `trace_summaries` belongs in this table and was missed.** It had the same defect from the same source — `traceSummary.foldProjection.ts` folds its timing baseline through the *same shared* `SpanTimingService.accumulateTiming`, with the same `0` sentinel and the same span-seeded-only rule, and its store admits log-only traces through a `hasPersistableSignal` predicate identical to the analytics one (its docblock names Claude Code Path B and Codex Path B outright). `trace_summaries` is `PARTITION BY toYearWeek(OccurredAt)` (00002) and its TTL anchors on `OccurredAt` (`ttlReconciler.ts:149-151`), so a log-only trace landed in `196952` with a deadline already past, exactly as on `trace_analytics`. Two differences shaped the independent fix:

- **Milder:** its sort key is `(TenantId, TraceId)` and does **not** include `OccurredAt`, so the RMT collapses a trace's versions regardless of the anchor moving. Consequence 1 (orphaned versions that can never collapse) does not apply, and the sort-key argument that shapes the `trace_analytics` fix is unnecessary here.
- **Worse:** it did not set `refoldOnStoreMiss`, which defaults to `false`. When the epoch row was reaped there was no rebuild net at all — `get()` missed, the fold restarted from `init()`, and the row was rewritten from post-reap events only. The failure mode was silent loss of the trace's accumulated cost, tokens and span count, not a refold storm.

Migration 00067 gives `trace_summaries` the same split: `OccurredAt` is the frozen storage/TTL anchor and `EarliestSpanStartMs` is the span timing baseline. Pre-split rows decode their existing `OccurredAt` as both values, avoiding a population refold. The fold also opts into `refoldOnStoreMiss`: losing accumulated totals is not acceptable, and absence is not authoritative while the store deliberately declines dimension-only rows.

That recovery is deliberately forward-only rather than a deployment-time sweep. A summary already removed by the epoch-anchored TTL before migration 00067 is rebuilt when a later event reaches the trace and `refoldOnStoreMiss` replays its event log; a completed trace that receives no later event is not proactively rediscovered. Those missing derived rows are bounded by the normal trace-retention window and age out with their source events. Reconstructing them eagerly would require a separate, bounded operational replay keyed from `event_log`; migration 00067 does not create that population-scale job.

`trace_analytics` knew about consequence 1 and priced only that one, exactly as ADR-056 did — its fold docblock said, before the amendment above replaced it, *"OccurredAt can shift when an earlier-starting span arrives late, so superseded rows may persist until TTL"*. The partition, TTL and dedup-scope consequences went unpriced there too.

Two honest differences, rather than flattening this into "same bug three times":

- **`evaluation_analytics` moves forwards**, so consequence 3 *inverts*: its TTL deadline moves *away* from the row, which outlives the retention it was promised rather than dying early. Consequences 1, 2 and 4 apply unchanged — a version can drift out of a caller's window upwards just as well as downwards.
- **`evaluation_analytics` already sets `eventOrdering: "acceptedAt"`** (`evaluationAnalytics.foldProjection.ts:466`). The codebase already refuses to trust producer business time for *ordering*, while still anchoring its *storage* on it. That inconsistency is the finding in one line.

#### The real axis: producer business time vs. platform accept time

A partition key, a sort key and a TTL anchor each need all three of **immutable**, **monotonic**, and **not producer-controlled**. Only accept time has all three.

- **Producer business time** — `occurredAt`, `startTimeUnixMs`, and every `min`/`max` folded over them. Backdatable by whoever is sending the telemetry, and mutated after the row is written. Fails all three.
- **Platform accept time** — assigned at ingest, written once, monotonic, and already the canonical event-log cursor. The codebase names it: `eventOrdering: "occurredAt" | "acceptedAt"`, where `acceptedAt` *"follows the canonical event-log cursor `(createdAt/EventTimestamp, EventId)` and is for lifecycle aggregates whose accepted transition order must win even when a producer submits a backdated business timestamp"* (`foldProjection.types.ts:130-140`).

**Accept time is strictly stronger than freezing.** Freezing makes the value immutable but leaves it producer-supplied, so one backdated first event pins that row into an old, cold, near-TTL partition **permanently**, and no later signal can move it out. Freezing removes the *mutation*; only accept time removes the *producer's control over which partition a row lives in and when it dies*.

**One trap for whoever implements it.** The anchor must be the **event log's** accept time threaded into the row — not the projection's own `CreatedAt`. `CreatedAt` is stamped `Date.now()` inside `init()` (`abstractFoldProjection.ts:206-213`), which is *fold* time, and `init()` re-runs on a read-back miss. It is platform-assigned but re-stampable, so it inherits exactly the caveat recorded above for a frozen `StartedAt`. The log cursor does not have that property.

#### The two trade-offs, stated rather than waved through

1. **TTL semantics change** from *"delete N days after it happened"* to *"delete N days after we accepted it"*. The upside is real: retention measured from **custody** is the date the platform can actually attest to, which is the auditable one — and it closes a live data-loss hazard, because today a producer that backdates `occurredAt` past the retention horizon gets a row deleted almost immediately after it lands. The downside is equally real for genuinely late-arriving telemetry, where the two dates differ by the lag. **This is a compliance decision and needs a human sign-off before implementation. This ADR does not settle it.** The near-term freeze deliberately sidesteps it: a frozen `StartedAt` is still business time, so retention semantics do not change under the interim step.
2. **Reads lose direct pruning on business time.** The resolution is ADR-068's existing shape, not a new mechanism: bound *accept* time by `[businessFrom − maxLag, businessTo]` so the partition filter still prunes, then apply the exact business-time predicate in the outer scope. **The window prunes; the exact predicate is what is correct.** That is the same split this ADR's own list-read fix relies on — a cheap bound for the planner, an exact test for the answer.

#### Scope of this finding

This records the **target anchor** and a **systemic finding across three tables**. *(As originally accepted: it re-plumbed nothing and added no migration. That held until the 2026-07-29 amendment, which ships migration 00061 for `trace_analytics`; the sentence stands as the record of the original decision, not of the current state.)* `trace_analytics` and `evaluation_analytics` are named as same-class instances so nobody re-derives this later; whether either also needs the consequence-4 read fix `coding_agent_sessions` just got belongs to sequencing step 4's audit, not to this change.

Also ruled out, unchanged:

- **The session id's embedded time — there is none.** `SessionId` is `provider` (the agent's own opaque session id) or `trace_fallback` (a trace id): `sessionKeySourceSchema = z.enum(["provider", "trace_fallback"])` (`contributions.ts:30`). Neither is a KSUID and neither carries a timestamp. This option does not exist.

**Note for whoever revisits this:** `PARTITION BY` cannot be altered on an existing table — that alone forces the create-new-and-swap. `ALTER TABLE … MODIFY TTL` *is* supported, so the TTL anchor could be repointed on its own if it were the only problem. It is not.

## What the re-key would actually cost

Stated plainly, because the cheap option is only honest if the expensive one is priced properly. ClickHouse cannot change `ORDER BY` or `PARTITION BY` in place, so this is **create-new + backfill + atomic `RENAME` swap + drop**, on a live, replicated, TTL'd table:

- **The backfill is the expensive part, and it is not `INSERT … SELECT … FINAL`.** `FINAL` collapses by the **old** sort key, so the orphans — which differ precisely in `StartedAt` — survive it. Collapsing them (which is half the point) needs an explicit dedup by `(TenantId, SessionId)` keeping `max(UpdatedAt)`: either the IN-tuple pattern the reads already use, or `argMax(col, UpdatedAt)` **per column** across ~90 columns. The `argMax` form is enormous generated SQL and memory-hungry; the IN-tuple form is a self-join. Either way it must be **chunked per partition**, because an unchunked full-table read of this table is the exact shape that starved ClickHouse merges into OOM on 2026-07-23 (ADR-066 §Context).
- **Writes cannot simply continue.** The fold writes continuously and per-aggregate serialization does not help across a table swap. The options are dual-write (two inserts per fold for the duration), pause the coding-agent consumer group across backfill+swap (bounded outage of session freshness, telemetry queues rather than drops), or backfill-then-catch-up-delta-then-swap (fastest cutover, most moving parts). Each is real work.
- **TTL interacts badly during the window.** Rows are expiring on the *old*, moving deadline while being copied to a table whose TTL is evaluated on the *new* anchor. A row can expire out of the source mid-backfill, and if the new anchor is `CreatedAt`, every row's deadline shifts at migration — generally *later*, i.e. data lives longer than the retention policy said it would. That is a data-retention statement, not a footnote.
- **Rollback is cheap only if you keep the old table.** The swap is `RENAME` in both directions, so reverting is fast — but any write that landed only in the new table is lost on revert unless dual-writing was in place.

For a table that is **one bounded row per coding-agent session**, this is a lot of machinery to buy a keyed seek and a one-off orphan cleanup, when the writer change removes the cause outright.

## Why the `MetricSeries` column is not dropped here

**Investigated, because a re-key would be the cheap moment to do it.** `coding_agent_sessions.MetricSeries` (00053) and `session_metric_series` (00052) genuinely duplicate: same event, same converged units, and the same three attribute dimensions (`type`, `decision`, `language`). They are not one read served twice — the embedded copy is read only by the fold's own read-back on the **write** path, the sibling table only by `withMetricTotals`' totals read on the **read** path.

**The decision to remove the embedded copy is [ADR-066](./066-projection-clickhouse-cached-store.md)'s, not this one's, and is already sequenced there as step 2** (along with the hazard to avoid in doing it). This ADR neither re-opens it nor bundles it. The only argument for bundling was timing: a re-key's backfill rewrites every row anyway, making it the cheapest moment for an `ALTER TABLE DROP COLUMN` that otherwise rewrites parts on a replicated table. Deferring the re-key evaporates that argument, so ADR-066 step 2 stands on its own, gated on its own number-changing validation.

## Sequencing and risk

1. **Now, and shipping with this ADR — the point read's tiebreak.** `findLatestRecord` ended in `LIMIT 1` with no `ORDER BY`, so two versions sharing `max(UpdatedAt)` resolved arbitrarily. It now orders by how far each version's fold got: the progress watermark, then span/log accumulator total, then converged metric-unit count (the only progress signal a metric-only session has), then applied-id count, then `StartedAt ASC`. That last key is a **deterministic last-resort tie-break** whose only job is to make the ordering total — it is deliberately *not* a progress signal, because a read-back miss can re-stamp `StartedAt` forwards (above), so its direction says nothing about which version folded more. This is **defence in depth, not a live bug fix**: `nextVersionStamp` already makes a tie unreachable while per-aggregate serialization holds. Reversible, no migration, no behaviour change when there is no tie. Matches the fix applied to the two sibling analytics repositories.
2. **Now, and shipping with this ADR — the list read's dedup scope.** `findManyRecent`'s inner `max(UpdatedAt)` subquery no longer filters on `StartedAt`; only the outer scope does. **This closes consequence 4** — the wrong answer — ahead of the freeze rather than behind it, because it needs no migration and no writer change. It costs an unwindowed dedup scan per list read (compact: sort-key columns plus `UpdatedAt`, one group row per session) until step 3 makes the pruning bound safe again. That cost ships **instrumented** — `coding_agent_session_list_read_duration_milliseconds{table,outcome}`, above — so the scan is a series rather than a claim, and step 3's trigger below is checkable rather than a matter of opinion. Reversible, no migration.
3. **Next — freeze the writer.** `StartedAt` becomes first-observed; add `EarliestSignalAt` for the business truth; point the session view and list display/sort at it. One additive migration, one fold change, one read-path change. **This is the change that closes consequences 1-3**, and it is what lets step 2's dedup scope take its pruning bound back. **What promotes it from "next" to "now" is a number, not a mood:** `coding_agent_session_list_read_duration_milliseconds` — a p99 on the `empty` outcome that climbs with tenant session counts rather than sitting flat means the compact-scan assumption this deferral rests on is wrong, and the freeze is due. A flat one is what earns the deferral its next interval. The retention guarantee is therefore *not* shipping here: `session-aggregate.feature`'s scenario *"a late signal does not shorten how long a session is kept"* is tagged `@unimplemented` and records this step's target rather than today's behaviour — untag it when the freeze lands. Reversible in the sense that reverting stops the freeze — it does not un-write frozen rows, and does not need to. It is an interim step, not the target: it stops the anchor moving but leaves it producer-supplied. None of it is wasted if the accept-time re-key later happens — `EarliestSignalAt` stays the displayed business truth either way, and splitting anchor from business value is a prerequisite for both.
4. **Then — audit the other range-filtered dedup scopes.** Consequence 4 is a *pattern*, not one query: any read that puts a mutable column in an IN-tuple dedup subquery has it. `findManyRecent` was the instance found here and is fixed. `trace_analytics` and `evaluation_analytics` — which anchor on a moving column too — were written unwindowed in their dedup scopes in the same batch, so they are **done, not pending**. What remains unswept is every other `max(UpdatedAt)` IN-tuple call site outside these three tables, plus the related class this review turned up: a dedup scope narrowed on a *fold-written* column that can be reset by a re-fold (`UserId`), which is the same defect without a range. `coding-agent-trace-session.repository.ts` was found and fixed by that widened sweep. This is what ADR-068's windowed-read discipline should be extended to say.
5. **Not now — ADR-066 step 2** (`MetricSeries` out of the fold). Independent, number-changing, its own validation.
6. **Not now, and gated on a human — the TTL semantics decision.** Adopting accept time as the anchor changes retention from *"N days after it happened"* to *"N days after we accepted it"*. Recorded above with the argument for it; it needs a deliberate sign-off, not an engineering judgement call, and nothing here presumes the answer.
7. **Deferred indefinitely — the table re-key, across all three tables.** Recorded as the correct end state so nobody re-derives it, priced above so nobody under-estimates it, and now with the anchor it should adopt: platform accept time, not a frozen business-time column.

**The triggers that would change the deferral** — any one is sufficient:

- **Orphan ratio.** Rows in `coding_agent_sessions` exceeding ~1.5× distinct `(TenantId, SessionId)` after the freeze has been live a full retention period. Post-freeze the residue is a fixed legacy population that ages out; if it does not, the model above is wrong.
- **A second correctness bug traced to the sort key rather than to the column moving.** The freeze fixes mutation; it does not make `(TenantId, StartedAt, SessionId)` a good key for point lookups. If per-session seeks become hot enough to matter, that is a real re-key motive rather than a hygiene one.
- **The table stops being one bounded row per session.** The cost analysis above rests on it being an aggregate. If it grows a heavy column, the backfill arithmetic changes and so does the balance. `coding_agent_session_list_read_duration_milliseconds` is the early warning: it prices the same assumption from the read side, and a scan cost that outruns session growth says the aggregate model slipped before anyone reads the schema.
- **A re-key becomes free.** If `coding_agent_sessions` is rebuilt for another reason (a projection-version replay per ADR-015, a retention-policy change forcing a TTL anchor move), take the new key — anchored on accept time — in the same rewrite. This is the most likely path to it ever happening.

**The systemic finding cuts towards doing it once, properly, rather than towards doing it sooner.** Three tables share the anchor defect, so three tables would share a rebuild's design, its backfill shape and its TTL-semantics decision. That is an argument for a single deliberate migration when one of them is being rebuilt anyway — not for three ad-hoc ones, and not for bringing the deferral forward on urgency it does not have now that the read is fixed.

**The risk of deferring**, stated plainly. The justification is no longer "the freeze closes consequence 4" — consequence 4 is closed here, in the read, and the deferral has to stand on what is left. It does, but the accounting differs per item:

- **Deferring the re-key (indefinitely)** leaves consequences 1 and 2: a bounded orphan population, O(distinct `StartedAt` values) per session rather than O(writes), which ages out at TTL instead of being cleaned up. That is **storage hygiene on an aggregate table** — no read returns a wrong answer because of it — and the orphan-ratio trigger above is what would reopen the decision if the bound turns out to be wrong.
- **Deferring the freeze (to the next step, not indefinitely)** leaves consequence 3: rows near their retention deadline can have the true-latest version deleted by a merge while a stale one survives, and the read then returns the stale one. That **is** a wrong answer — the honest statement is that consequence 4 was the only one wrong on an *ordinary* day, not the only one capable of being wrong at all. Its fuse is a full retention period (308 days by default), which is why it has only ever been observed in a test fixture that backdated a row onto the boundary. It also leaves the list read paying an unwindowed dedup scan, which exists only because the anchor still moves — now measured rather than assumed, so the interval this deferral gets is one the metric grants rather than one anybody argues for.

We accept both. Neither is a wrong answer on an ordinary read once this change lands: what remains is a legacy orphan population that expires on its own, and one fuse measured in a full retention period whose fix is the very next step rather than an open-ended one.

## Rules

- **A storage anchor is platform-assigned accept time, written once.** A ReplacingMergeTree sort key, a `PARTITION BY` and a TTL anchor each need all three of **immutable**, **monotonic** and **not producer-controlled**. `occurredAt`, `startTimeUnixMs` and every `min`/`max` folded over them fail all three, whatever the column is named — `StartedAt` and `OccurredAt` are the same mistake. If a fold derives a value that can change (a min, a max, a first-seen that can be revised), that value is a **payload column**. Freezing such a value is an improvement, not the rule: it stops the mutation but leaves the producer deciding which partition the row lives in and when it dies.
- **A column that is a storage anchor and a displayed business value at the same time is a bug waiting for a late event.** Split them: the anchor is accept time (frozen business time is the interim step, not the target), the business value is free to move.
- **Prune on the anchor, answer on the business value.** When the anchor is accept time and the caller asks in business time, bound accept time by `[businessFrom − maxLag, businessTo]` for partition pruning and apply the exact business-time predicate in the outer scope. The window prunes; the exact predicate is what is correct (ADR-068).
- **A dedup subquery must never filter on a column that can move a row out of the caller's range.** The outer scope may be range-filtered for partition pruning; the inner `max(version)` scope must resolve the true latest. Both reads on this table now obey it and say why in their docblocks — `findLatestRecord` always did, and `findManyRecent`'s range filter was removed from its dedup scope in this change. Only the **key** narrowing (`TenantId`) stays in both scopes, because it is part of the dedup group itself. A column is not exempt merely because it never moves in a range sense: `UserId` is fold-written, absent from spans, and reset to `null` by any re-fold from `init()`, so a later version can carry an empty value while holding `max(<version>)` — filtering the group on it then resolves to a superseded row. It is narrowed in the outer scope only. **Not even an upper bound is safe on a moving column**, because a read-back miss re-stamps the anchor *forwards*, so "the latest version holds the smallest value" does not hold.
- **A LIST read must collapse to one row per key itself.** The IN-tuple matches
  `(key, max(version))`, so versions that TIE on the version column all satisfy
  it and the key renders more than once — and versions that tie are exactly the
  ones the RMT never collapses, because they differ in the sort key. A point read
  closes this with `ORDER BY … LIMIT 1`; a list read cannot, since its own
  `ORDER BY` is the caller's sort, so it applies the same ranking per key after
  the read. Skipping it is not a cosmetic duplicate: any caller that reduces over
  the list (`getUsageTotals` does) counts that key twice.
- **A latest-version point read ends in a deterministic `ORDER BY … LIMIT 1`**, ranked by fold progress and closed by a stable key that makes the order total, even where a write-side version stamp already makes ties unreachable. The stamp is the mechanism; the tiebreak is the backstop, and it costs nothing because the IN-tuple has already cut the input to the tied rows. **The closing key buys determinism, not correctness** — do not justify it as picking the better-informed row unless the column it reads is itself a monotonic progress signal.
- **`TenantId` is first in every scope, outer and inner.** Unchanged, restated because this ADR touches both scopes of two queries.

## References

- **Behavioural contract:** [specs/coding-agent/session-aggregate.feature](../../../specs/coding-agent/session-aggregate.feature)
- [ADR-034](./034-event-sourced-analytics-materialization.md) — analytics materialisation (the RMT + IN-tuple shape)
- [ADR-056](./056-coding-agent-pipeline-session-aggregate.md) — coding-agent session aggregate (its key choice is corrected here)
- [ADR-066](./066-projection-clickhouse-cached-store.md) — read-back fold store (writes this row; owns the `MetricSeries` step 2 this ADR declines to bundle)
- [ADR-068](./068-windowed-clickhouse-reads.md) — windowed ClickHouse reads (the list read here is the counter-example; sequencing step 4 extends its discipline to the dedup-scope rule)
- [ADR-015](./015-projection-replay-coordination.md) — replay coordination (the most likely vehicle for a re-key, if it ever happens)
- `dev/docs/best_practices/clickhouse-queries.md` — IN-tuple dedup, version-stamp monotonicity, the `ORDER BY <version> DESC LIMIT 1` anti-pattern this tiebreak is not
- **Same-class instances of the anchor defect.** FIXED since: `trace_analytics` (`00039_create_trace_analytics.sql:189-192`, migration 00061) and `trace_summaries` (`00002_create_schema.sql`, migration 00067). STILL RECORDED-ONLY, not changed: `00041_create_evaluation_analytics.sql:135-138` with `evaluationAnalytics.foldProjection.ts:252` and `abstractFoldProjection.ts:235-238`.
- **Accept time as the codebase already names it:** `foldProjection.types.ts:130-140` (`eventOrdering: "occurredAt" | "acceptedAt"`, the `(createdAt/EventTimestamp, EventId)` log cursor)
