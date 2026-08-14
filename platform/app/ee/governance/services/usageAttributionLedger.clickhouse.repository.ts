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
   * up. `governance_ocsf_events` and `governance_kpis` are ReplacingMergeTrees
   * whose duplicates only collapse at merge time, and the shipped KPI read
   * skips that dedup deliberately for an anomaly evaluator that can tolerate
   * it. A money report cannot: a replayed event would otherwise double both
   * its own count and its spend.
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
          SELECT TraceId, sum(SpendUsd) AS TraceSpendUsd
          FROM ${KPIS_TABLE}
          WHERE TenantId = {tenantId:String}
            AND HourBucket >= toStartOfHour(fromUnixTimestamp64Milli({fromMs:UInt64}))
            AND HourBucket < fromUnixTimestamp64Milli({toMs:UInt64})
            AND (TenantId, SourceId, HourBucket, TraceId, LastEventOccurredAt) IN (
              SELECT TenantId, SourceId, HourBucket, TraceId, max(LastEventOccurredAt)
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
