// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";

const OCSF_TABLE = "governance_ocsf_events" as const;
const KPIS_TABLE = "governance_kpis" as const;

/**
 * One (login, trace) group inside the reported window: how many ledger events
 * it carried, what it cost, and when it started.
 */
export interface AttributionLedgerRow {
  /** `IngestionSource.id` — also the link list's `providerConnectionId`. */
  sourceId: string;
  /** The provider's own id for the actor. Empty when the adapter sends none. */
  actorUserId: string;
  /** The actor's address as the provider spelled it. Empty when absent. */
  actorEmail: string;
  /** OCSF `actor.user.type` — the exact ingest-time bucket, when present. */
  actorType: string;
  /** OCSF `actor.user.type_id` — the coarse fallback. */
  actorTypeId: number;
  traceId: string;
  events: number;
  spendUsd: number;
  /**
   * When this trace's first event landed for this login. The whole group is
   * attributed at this moment — see the note on `findLedger` for why a trace
   * is treated as one indivisible unit of work.
   */
  firstEventMs: number;
}

/** What the report reads its money from. */
export interface AttributionLedgerReader {
  findLedger(input: {
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<AttributionLedgerRow[]>;
}

/**
 * The reader for an organization with nothing to read: no hidden governance
 * project, or an instance with no ClickHouse at all.
 *
 * An empty ledger rather than a null service, so the report is ALWAYS
 * constructible. Otherwise every caller carries a second code path for the
 * empty case — and the export procedure quietly grew one that produced zeros
 * without recording that a period had been reported, which is the one thing an
 * export exists to do.
 */
export class EmptyAttributionLedger implements AttributionLedgerReader {
  async findLedger(): Promise<AttributionLedgerRow[]> {
    return [];
  }
}

/**
 * The money side of the usage-attribution report (ADR-094 Decision 2).
 *
 * It answers one question — "who did the provider say acted, how often, and at
 * what cost, inside this window" — and answers it with queries only. No
 * ClickHouse schema was added for this report: the ADR budgeted exactly one
 * ClickHouse change and the write-path batch spent it on the `ActorUserId`
 * index. Everything else is `JSONExtract` over the payload we already store.
 */
export class UsageAttributionLedgerClickHouseRepository
  implements AttributionLedgerReader
{
  /**
   * Takes a resolver rather than a client, like every other governance
   * repository: the client is chosen per tenant so an organization on a
   * private ClickHouse cluster routes there, and reaching for
   * `getClickHouseClientForOrganization` from a service would open the third
   * door the access-boundary test exists to keep shut.
   */
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  /**
   * Ledger rows for one governance tenant over [from, to).
   *
   * SPEND COMES FROM TWO PLACES, and the precedence is deliberate.
   *
   * `governance_kpis` is the authoritative per-trace spend, but it only exists
   * for traffic that arrived through the receiver and became a trace: the KPI
   * rows are written by a reactor on the trace-processing pipeline. Pulled
   * provider usage — the traffic this whole ADR is about — is written straight
   * to `governance_ocsf_events` by the puller and never becomes a trace, so it
   * has no KPI row at all and carries its cost inside the OCSF payload
   * instead.
   *
   * So: if a KPI row exists for the trace, its summed `SpendUsd` is the
   * answer, INCLUDING when that sum is zero. A zero there is an authoritative
   * zero, not a reason to go looking in the payload — mixing the two sources
   * per row is how a money report starts drifting from the ledger it claims to
   * summarise. Only the absence of a KPI row falls through to the payload's
   * `cost_usd`.
   *
   * The KPI side is SUMMED per trace rather than picked, because a trace whose
   * events straddle an hour legitimately holds several KPI rows — the table is
   * keyed (TenantId, SourceId, HourBucket, TraceId).
   *
   * BOTH sides are deduped to their latest version before anything is added
   * up, and on the KPI side that is not a precaution — it is required for the
   * number to mean anything. The KPI reactor is LEVEL-TRIGGERED: it writes the
   * trace's RUNNING TOTALS on a throttle window, so a trace that emits over
   * several windows leaves several rows under the same key, each carrying a
   * larger cumulative figure. Summing them undeduped does not double-count a
   * replay, it sums a trace's cost against itself as many times as the trace
   * was flushed. The shipped `findSpendTotals` skips this deliberately for an
   * anomaly evaluator comparing two windows, where the distortion is on both
   * sides; a money report has no such luxury.
   *
   * The KPI window bound is tight rather than generous, and that is load-
   * bearing. Both reactors take their timestamp from the same
   * `foldState.occurredAt`: the OCSF row's `EventTime` IS that value and the
   * KPI row's `HourBucket` is `toStartOfHour` of it. So for any event this
   * query admits — `EventTime >= from` — its KPI row satisfies
   * `HourBucket >= toStartOfHour(from)`, and no in-window trace's spend can
   * fall outside the bound. Changing that lower bound to `from` rather than
   * `toStartOfHour(from)` would silently drop the spend of every trace in the
   * first hour of the window.
   *
   * A (login, trace) group is attributed as ONE unit at its first event. A
   * trace is one piece of work, and splitting it across a link handover that
   * happened in the middle of it would attribute half a request to each of two
   * people. For pulled events the question does not arise — their trace id is
   * synthesized per event, so the group is a single event anyway.
   */
  async findLedger(input: {
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<AttributionLedgerRow[]> {
    const client = await this.resolveClient(input.tenantId);
    const result = await client.query({
      query: `
        WITH deduped_events AS (
          SELECT
            SourceId,
            TraceId,
            EventTime,
            ActorUserId,
            ActorEmail,
            JSONExtractString(RawOcsfJson, 'actor', 'user', 'type') AS ActorType,
            JSONExtractInt(RawOcsfJson, 'actor', 'user', 'type_id') AS ActorTypeId,
            JSONExtractFloat(RawOcsfJson, 'metadata', 'extension', 'cost_usd') AS PayloadCostUsd
          FROM ${OCSF_TABLE}
          WHERE TenantId = {tenantId:String}
            AND EventTime >= fromUnixTimestamp64Milli({fromMs:UInt64})
            AND EventTime < fromUnixTimestamp64Milli({toMs:UInt64})
            AND (TenantId, EventId, LastUpdatedAt) IN (
              SELECT TenantId, EventId, max(LastUpdatedAt)
              FROM ${OCSF_TABLE}
              WHERE TenantId = {tenantId:String}
                AND EventTime >= fromUnixTimestamp64Milli({fromMs:UInt64})
                AND EventTime < fromUnixTimestamp64Milli({toMs:UInt64})
              GROUP BY TenantId, EventId
            )
        ),
        trace_spend AS (
          SELECT TraceId, sum(KeySpendUsd) AS TraceSpendUsd
          FROM (
            -- argMax, NOT the IN-tuple dedup the sibling reads use. That
            -- pattern only collapses duplicates when the version column
            -- strictly increases per write, and this one does not:
            -- LastEventOccurredAt is set from the trace's own
            -- foldState.occurredAt, a fact about the DATA rather than a
            -- clock. Re-deliver the same reactor event and both rows carry an
            -- identical version, both satisfy the tuple, and a plain sum adds
            -- the trace's cost to itself. argMax picks one row per key
            -- whatever the versions do, and where they tie the rows are
            -- identical copies, so either is the same answer.
            SELECT
              TraceId,
              argMax(SpendUsd, LastEventOccurredAt) AS KeySpendUsd
            FROM ${KPIS_TABLE}
            WHERE TenantId = {tenantId:String}
              AND HourBucket >= toStartOfHour(fromUnixTimestamp64Milli({fromMs:UInt64}))
              AND HourBucket < fromUnixTimestamp64Milli({toMs:UInt64})
            GROUP BY TenantId, SourceId, HourBucket, TraceId
          )
          GROUP BY TraceId
        )
        SELECT
          e.SourceId AS sourceId,
          e.ActorUserId AS actorUserId,
          e.ActorEmail AS actorEmail,
          e.ActorType AS actorType,
          toString(e.ActorTypeId) AS actorTypeId,
          e.TraceId AS traceId,
          toString(count()) AS events,
          toString(toUnixTimestamp64Milli(min(e.EventTime))) AS firstEventMs,
          -- The KPI value is per trace, so the LEFT JOIN repeats it on every
          -- event row: take it once. The payload value is per EVENT, so the
          -- events of one trace add up.
          --
          -- any() is right because a trace produces exactly ONE row in this
          -- table, from either writer: the push reactor keys its row
          -- EventId = TraceId, and the puller synthesizes pull:<eventId>,
          -- unique per event. One trace is one group here, so the repeated KPI
          -- value is taken exactly once. A third writer emitting several OCSF
          -- rows per trace would break that, and would first have to decide
          -- which of them the trace's cost belongs to.
          toString(any(k.TraceSpendUsd)) AS kpiSpendUsd,
          toString(sum(e.PayloadCostUsd)) AS payloadSpendUsd,
          -- Existence, not magnitude: a KPI row saying zero is an answer.
          toString(max(k.TraceId != '')) AS hasKpiRow
        FROM deduped_events e
        LEFT JOIN trace_spend k ON k.TraceId = e.TraceId
        GROUP BY sourceId, actorUserId, actorEmail, actorType, actorTypeId, traceId
      `,
      query_params: {
        tenantId: input.tenantId,
        fromMs: input.from.getTime(),
        toMs: input.to.getTime(),
      },
      format: "JSONEachRow",
      // Pinned, not assumed. `hasKpiRow` reads the LEFT JOIN's unmatched
      // default as the empty string; under `join_use_nulls = 1` it would be
      // NULL, the marker would be neither "1" nor "0", and EVERY KPI-backed
      // trace would fall through to the payload cost — which for a pushed
      // trace is the number this design deliberately ignores. The repo pins
      // this explicitly wherever it matters; so does this.
      clickhouse_settings: { join_use_nulls: 0 },
    });

    const rows = (await result.json()) as Array<{
      sourceId: string;
      actorUserId: string;
      actorEmail: string;
      actorType: string;
      actorTypeId: string;
      traceId: string;
      events: string;
      firstEventMs: string;
      kpiSpendUsd: string;
      payloadSpendUsd: string;
      hasKpiRow: string;
    }>;

    return rows.map((row) => ({
      sourceId: row.sourceId,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      actorType: row.actorType,
      actorTypeId: Number(row.actorTypeId),
      traceId: row.traceId,
      events: Number(row.events),
      firstEventMs: Number(row.firstEventMs),
      spendUsd:
        row.hasKpiRow === "1"
          ? Number(row.kpiSpendUsd)
          : Number(row.payloadSpendUsd),
    }));
  }
}
