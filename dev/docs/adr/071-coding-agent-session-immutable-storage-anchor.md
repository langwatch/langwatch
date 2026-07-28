# ADR-071: `coding_agent_sessions` has a mutable storage anchor — freeze it in the writer, defer the re-key

**Date:** 2026-07-28

**Status:** Accepted

**Corrects:** [ADR-056](./056-coding-agent-pipeline-session-aggregate.md) §"Engine / partition / retention" — the decision to lead the sort key with `StartedAt` and to anchor both the partition and the TTL on it. ADR-056 knew the column moved and priced only the *dedup* cost; it did not price the partition, the TTL, or the range-filtered list read.

**Relates to:** [ADR-066](./066-projection-clickhouse-cached-store.md) (the read-back store that writes this row, and its `MetricSeries` step 2), [ADR-068](./068-windowed-clickhouse-reads.md) (windowed reads — the list read here is the counter-example that motivates the rule), [ADR-034](./034-event-sourced-analytics-materialization.md) (the RMT-plus-IN-tuple materialisation shape).

## Context

`coding_agent_sessions` overloads **one mutable column** with three storage jobs:

```
ENGINE = ReplacingMergeTree(UpdatedAt)      -- migration 00051:192
PARTITION BY toYearWeek(StartedAt)          -- 00051:193
ORDER BY (TenantId, StartedAt, SessionId)   -- 00051:194  (the RMT dedup key)
TTL IF(_retention_days > 0, toDateTime(StartedAt) + toIntervalDay(_retention_days), …) DELETE  -- 00051:195
```

`StartedAt` is not stable. The fold takes the **minimum** business time it has ever seen for the session:

```ts
// codingAgentSession.foldProjection.ts:165-170
// The session starts when its earliest signal does. Spans refine this
// below with their own start time, which can predate arrival order.
startedAtMs:
  state.startedAtMs === 0
    ? data.occurredAt
    : Math.min(state.startedAtMs, data.occurredAt),
```

Every fold delivery can move it, and it only ever moves **backwards**. So the dedup key, the partition key and the TTL anchor are all a moving target, and each moves for a different reason than the others care about.

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

### Consequence 4 — the one that is wrong *today*, at any age

The claim that "reads still return the right row because the repository dedups by `(TenantId, SessionId) + max(UpdatedAt)`" holds for the **point** read and fails for the **list** read.

The point read is safe *because it was deliberately built to be*. Its inner dedup subquery is unwindowed (`coding-agent-session.clickhouse.repository.ts:376-382`), and the docblock above it explains exactly why: windowing it too would let a session whose latest version drifted outside the window read back as a stale in-window version.

`findManyRecent` applies the same `StartedAt` range filter to **both** scopes — outer *and* inner:

```sql
-- coding-agent-session.clickhouse.repository.ts:466-473
AND (TenantId, SessionId, UpdatedAt) IN (
  SELECT TenantId, SessionId, max(UpdatedAt)
  FROM coding_agent_sessions
  WHERE TenantId = {tenantId:String}
    AND StartedAt BETWEEN … {from} AND … {to}   -- ← the mutable column, in the dedup scope
  GROUP BY TenantId, SessionId
)
```

So when a session's latest version backdates `StartedAt` **out** of the requested window while an older version remains **inside** it, the subquery computes `max(UpdatedAt)` over the older versions only, and the list renders the session **at a start time it never had, with stale totals**. No fallback catches it: the result is non-null and looks fine.

This is reachable without any TTL involvement and without a week boundary. A day-bounded view is enough: a session whose first telemetry to arrive is a log from 00:10 today writes `StartedAt = today 00:10`; the 23:50 span from yesterday then arrives and moves it to yesterday, outside "today" — and today's list keeps showing the first version forever.

**This is the consequence that justifies acting.** The other three are storage hygiene with long fuses; this one is a wrong answer on a normal day.

## Decision

**The correct end state is a dedup key with no mutable column in it — `ORDER BY (TenantId, SessionId)` — with a partition key and TTL anchor that do not move.**

**We are not migrating the table to get there. We are making `StartedAt` immutable in the writer instead, and deferring the re-key behind named triggers.**

The reasoning is that **all four consequences are caused by the column moving, not by which column is in the key.** Freeze the anchor at the source and every one of them stops for rows written afterwards — with no new table, no backfill, and no swap:

| Consequence | Fixed by re-keying the table? | Fixed by freezing the writer? |
|---|---|---|
| 1. Orphaned versions | Yes | Yes — versions share a sort key again, so RMT collapses them |
| 2. Cross-partition orphans | Yes | Yes — every version of a session lands in one partition |
| 3. TTL deadline moves | Only if the anchor also changes | Yes — the deadline is set once |
| 4. List read returns a stale version | **No** — the list filters `StartedAt` because it is the partition key; a re-key alone leaves it mutable | Yes — no version can be in-window while another is out |

Re-keying alone does not fix the consequence that actually bites. Freezing does, and it is the cheap half.

### What "freeze" means concretely

1. **`StartedAt` becomes first-observed, not minimum** — `state.startedAtMs === 0 ? data.occurredAt : state.startedAtMs`. It stops being business truth and becomes what it is already being used as: a **storage anchor** for partitioning, TTL and range pruning.
2. **A new, mutable `EarliestSignalAt` column carries the business truth** — the `Math.min` that `StartedAt` does today — and is what the session view and the list *display* and sort on. This is an additive `ALTER TABLE ADD COLUMN`, which ClickHouse does as a metadata change; it costs nothing like a re-key.
3. **The two differ by fold latency, not by session length.** `StartedAt` is the first signal *folded*; `EarliestSignalAt` is the earliest signal *observed*. For in-order telemetry they are equal. The gap is bounded by how out-of-order arrival gets, and only the anchor is affected — nothing a user sees moves.

The same honesty applies to both options: neither `StartedAt`-frozen nor any alternative column is *structurally* immutable, because a read-back miss re-runs `init()` and re-stamps (`abstractFoldProjection.ts:207-211`). It is immutable **for a live aggregate that reads back successfully**, which is the invariant ADR-066 already depends on everywhere else. A re-key would inherit exactly the same caveat, so it is not a reason to prefer one over the other.

### Which column, if we ever do re-key

Ruled out on evidence:

- **The session id's embedded time — there is none.** `SessionId` is `provider` (the agent's own opaque session id) or `trace_fallback` (a trace id): `sessionKeySourceSchema = z.enum(["provider", "trace_fallback"])` (`contributions.ts:30`). Neither is a KSUID and neither carries a timestamp. This option does not exist.
- **`CreatedAt`** is the closest thing to an immutable column — stamped once at `init()` and threaded through read-back — but anchoring TTL on it changes retention semantics from *"delete N days after the session happened"* to *"delete N days after we first folded it"*. For late-arriving telemetry those differ, and retention semantics are a compliance surface, not an implementation detail. It is defensible (arguably more correct), but it is a **separate decision** that must be made deliberately, not as a side effect of a storage fix.

A frozen `StartedAt` sidesteps this entirely: it stays business time, so retention semantics are unchanged.

**Note for whoever revisits this:** `PARTITION BY` cannot be altered on an existing table — that alone forces the create-new-and-swap. `ALTER TABLE … MODIFY TTL` *is* supported, so the TTL anchor could be repointed on its own if it were the only problem. It is not.

## What the re-key would actually cost

Stated plainly, because the cheap option is only honest if the expensive one is priced properly. ClickHouse cannot change `ORDER BY` or `PARTITION BY` in place, so this is **create-new + backfill + atomic `RENAME` swap + drop**, on a live, replicated, TTL'd table:

- **The backfill is the expensive part, and it is not `INSERT … SELECT … FINAL`.** `FINAL` collapses by the **old** sort key, so the orphans — which differ precisely in `StartedAt` — survive it. Collapsing them (which is half the point) needs an explicit dedup by `(TenantId, SessionId)` keeping `max(UpdatedAt)`: either the IN-tuple pattern the reads already use, or `argMax(col, UpdatedAt)` **per column** across ~90 columns. The `argMax` form is enormous generated SQL and memory-hungry; the IN-tuple form is a self-join. Either way it must be **chunked per partition**, because an unchunked full-table read of this table is the exact shape that starved ClickHouse merges into OOM on 2026-07-23 (ADR-066 §Context).
- **Writes cannot simply continue.** The fold writes continuously and per-aggregate serialization does not help across a table swap. The options are dual-write (two inserts per fold for the duration), pause the coding-agent consumer group across backfill+swap (bounded outage of session freshness, telemetry queues rather than drops), or backfill-then-catch-up-delta-then-swap (fastest cutover, most moving parts). Each is real work.
- **TTL interacts badly during the window.** Rows are expiring on the *old*, moving deadline while being copied to a table whose TTL is evaluated on the *new* anchor. A row can expire out of the source mid-backfill, and if the new anchor is `CreatedAt`, every row's deadline shifts at migration — generally *later*, i.e. data lives longer than the retention policy said it would. That is a data-retention statement, not a footnote.
- **Rollback is cheap only if you keep the old table.** The swap is `RENAME` in both directions, so reverting is fast — but any write that landed only in the new table is lost on revert unless dual-writing was in place.

For a table that is **one bounded row per coding-agent session**, this is a lot of machinery to buy a keyed seek and a one-off orphan cleanup, when the writer change removes the cause outright.

## The `MetricSeries` question

**Verdict: they genuinely duplicate the same data, and ADR-066 already decided to drop the embedded copy. This ADR does not re-open that, and does not bundle it.**

Both are fed by the **same event** (`MetricFactsContributedEvent`) and both persist the **same converged units**. The attribute projections coincide exactly, which is the part worth checking rather than assuming: the map projection persists precisely `type`, `decision`, `language` —

```ts
// sessionMetricSeries.mapProjection.ts:39
const PERSISTED_ATTRIBUTE_KEYS = new Set(["type", "decision", "language"]);
```

— and the embedded column is `Array(Tuple(SeriesId, MetricName, Type, Decision, Language, Value))` (00053:60). Same three dimensions. This is duplication, not two different shapes.

**Who reads which, which is what decides it:**

| | Read by | On which path |
|---|---|---|
| `coding_agent_sessions.MetricSeries` (embedded, 00053) | the fold's own read-back — `fromRecord` rebuilding `metricSeries` so `recomputeMetricOverlay` reproduces the nine metric-fed fields | **write** path, per delivery |
| `session_metric_series` (table, 00052) | `CodingAgentSessionService.withMetricTotals` → `findTotalsBySessionIds` (`coding-agent-session.service.ts:243`) | **read** path, per query |

So this is *not* one read served twice. It is a write-side state round-trip and a read-side aggregate, which is a legitimate CQRS split — **but that is not why the embedded copy exists**. Migration 00053 says so itself: *"Transitional per ADR-066 step 2: this map later leaves the fold for `session_metric_series`"* (00053:38-41), and ADR-066 §169 sequences the removal: drop `metricSeries`, `recomputeMetricOverlay` and the nine metric-fed columns from the fold, and serve those values from the already-existing service overlay, extending `findTotalsBySessionIds` to bucket by `decision` and `language` as well as `type`.

That sequencing is right, and one hazard is worth recording because it is the obvious wrong way to do it: **the embedded copy must not be replaced by having the fold read `session_metric_series` back on the delivery path.** That would make one projection's hot path depend on another projection's write having landed, and a not-yet-visible series would silently reconstruct state with that series missing — which, because the overlay *replaces* per series rather than incrementing, regresses the metric-fed fields to zero and then rewrites them. ADR-066 step 2 does not do this (it removes the nine fields from the fold entirely, so the fold stops needing the map at all), and any future shortcut that does should be rejected.

**Interaction with this ADR:** a re-key's backfill rewrites every row anyway, so it would be the cheapest moment to drop the column — an `ALTER TABLE DROP COLUMN` is otherwise a mutation that rewrites parts on a replicated table. That is a genuine argument for bundling the two **if** the re-key happens. Since we are deferring the re-key, it evaporates: ADR-066 step 2 stands on its own, unchanged, and is gated on its own number-changing validation.

## Sequencing and risk

1. **Now, and shipping with this ADR — the point read's tiebreak.** `findLatestRecord` ended in `LIMIT 1` with no `ORDER BY`, so two versions sharing `max(UpdatedAt)` resolved arbitrarily. It now orders by how far each version's fold got: the progress watermark, then span/log accumulator total, then converged metric-unit count (the only progress signal a metric-only session has), then applied-id count, then `StartedAt ASC` — smallest is best-informed, because it is the minimum. This is **defence in depth, not a live bug fix**: `nextVersionStamp` already makes a tie unreachable while per-aggregate serialization holds. Reversible, no migration, no behaviour change when there is no tie. Matches the fix applied to the two sibling analytics repositories.
2. **Next — freeze the writer.** `StartedAt` becomes first-observed; add `EarliestSignalAt` for the business truth; point the session view and list display/sort at it. One additive migration, one fold change, one read-path change. **This is the change that closes consequences 1-4.** Reversible in the sense that reverting stops the freeze — it does not un-write frozen rows, and does not need to.
3. **Then — audit the other range-filtered dedup scopes.** Consequence 4 is a *pattern*, not one query: any read that puts a mutable column in an IN-tuple dedup subquery has it. `findManyRecent` is the instance found here. This is what ADR-068's windowed-read discipline should be extended to say.
4. **Not now — ADR-066 step 2** (`MetricSeries` out of the fold). Independent, number-changing, its own validation.
5. **Deferred indefinitely — the table re-key.** Recorded as the correct end state so nobody re-derives it, and priced above so nobody under-estimates it.

**The triggers that would change the deferral** — any one is sufficient:

- **Orphan ratio.** Rows in `coding_agent_sessions` exceeding ~1.5× distinct `(TenantId, SessionId)` after the freeze has been live a full retention period. Post-freeze the residue is a fixed legacy population that ages out; if it does not, the model above is wrong.
- **A second correctness bug traced to the sort key rather than to the column moving.** The freeze fixes mutation; it does not make `(TenantId, StartedAt, SessionId)` a good key for point lookups. If per-session seeks become hot enough to matter, that is a real re-key motive rather than a hygiene one.
- **The table stops being one bounded row per session.** The cost analysis above rests on it being an aggregate. If it grows a heavy column, the backfill arithmetic changes and so does the balance.
- **A re-key becomes free.** If `coding_agent_sessions` is rebuilt for another reason (a projection-version replay per ADR-015, a retention-policy change forcing a TTL anchor move), take the new key in the same rewrite. This is the most likely path to it ever happening.

**The risk of deferring**, stated plainly: consequence 3 keeps its 308-day fuse on rows written before the freeze, and consequences 1 and 2 leave a bounded legacy orphan population that ages out at TTL rather than being cleaned up. We accept both. Neither is a wrong answer on the read path once the freeze lands, because the freeze also closes consequence 4 — which is the only one that returns wrong data today.

## Rules

- **No mutable column in a ReplacingMergeTree sort key, a `PARTITION BY`, or a TTL anchor.** If a fold derives a value that can change (a min, a max, a first-seen that can be revised), that value is a **payload column**, not a storage anchor. A storage anchor is written once.
- **A column that is a storage anchor and a displayed business value at the same time is a bug waiting for a late event.** Split them: the anchor is frozen, the business value is free to move.
- **A dedup subquery must never filter on a column that can move a row out of the caller's range.** The outer scope may be range-filtered for partition pruning; the inner `max(version)` scope must resolve the true latest. `findLatestRecord` gets this right and says why; `findManyRecent` does not.
- **A latest-version point read ends in a deterministic `ORDER BY … LIMIT 1`**, ranked by fold progress, even where a write-side version stamp already makes ties unreachable. The stamp is the mechanism; the tiebreak is the backstop, and it costs nothing because the IN-tuple has already cut the input to the tied rows.
- **`TenantId` is first in every scope, outer and inner.** Unchanged, restated because this ADR touches both scopes of two queries.

## References

- **Behavioural contract:** [specs/coding-agent/session-aggregate.feature](../../../specs/coding-agent/session-aggregate.feature)
- [ADR-034](./034-event-sourced-analytics-materialization.md) — analytics materialisation (the RMT + IN-tuple shape)
- [ADR-056](./056-coding-agent-pipeline-session-aggregate.md) — coding-agent session aggregate (its key choice is corrected here)
- [ADR-066](./066-projection-clickhouse-cached-store.md) — read-back fold store (writes this row; owns the `MetricSeries` step 2 this ADR declines to bundle)
- [ADR-068](./068-windowed-clickhouse-reads.md) — windowed ClickHouse reads (extended by sequencing step 3)
- [ADR-015](./015-projection-replay-coordination.md) — replay coordination (the most likely vehicle for a re-key, if it ever happens)
- `dev/docs/best_practices/clickhouse-queries.md` — IN-tuple dedup, version-stamp monotonicity, the `ORDER BY <version> DESC LIMIT 1` anti-pattern this tiebreak is not
