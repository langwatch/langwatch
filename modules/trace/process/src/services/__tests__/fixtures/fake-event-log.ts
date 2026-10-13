import type { QueryRequest } from "@langwatch/clickhouse-client";
import type { EventingClickHouseReplayClient } from "@langwatch/eventing/server";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";

/** One `event_log` row, as the replay reads it back. */
export interface FakeEventLogRow {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventType: string;
  EventTimestamp: number;
  EventOccurredAt: number;
  EventVersion: string;
  EventPayload: string;
}

type QueryParams = Record<string, any>;

/** The discover query: which aggregates carry which of the asked-for event types. */
function answerDiscover(rows: FakeEventLogRow[], p: QueryParams): unknown[] {
  const et: string[] = p.eventTypes ?? [];
  const since: number = p.sinceMs ?? 0;
  const tenant: string | undefined = p.tenantId;
  const matched = rows.filter(
    (r) =>
      et.includes(r.EventType) &&
      r.EventTimestamp >= since &&
      (!tenant || r.TenantId === tenant),
  );

  const groups = new Map<
    string,
    { tenantId: string; aggregateType: string; aggregateId: string; eventTypes: Set<string> }
  >();
  for (const r of matched) {
    const k = `${r.TenantId}|${r.AggregateType}|${r.AggregateId}`;
    let g = groups.get(k);
    if (!g) {
      g = {
        tenantId: r.TenantId,
        aggregateType: r.AggregateType,
        aggregateId: r.AggregateId,
        eventTypes: new Set(),
      };
      groups.set(k, g);
    }
    g.eventTypes.add(r.EventType);
  }

  return [...groups.values()].map((g) => ({
    tenantId: g.tenantId,
    aggregateType: g.aggregateType,
    aggregateId: g.aggregateId,
    eventTypes: [...g.eventTypes],
  }));
}

/** The occurred-at bounds query: the count and the min/max occurrence of the named aggregates. */
function answerOccurredAtBounds(rows: FakeEventLogRow[], p: QueryParams): unknown[] {
  const aggTypes: string[] = p.aggregateTypes ?? [];
  const aggIds: string[] = p.aggregateIds ?? [];
  const matched = rows.filter(
    (r) =>
      r.TenantId === p.tenantId &&
      aggTypes.includes(r.AggregateType) &&
      aggIds.includes(r.AggregateId),
  );
  if (matched.length === 0) {
    return [{ cnt: "0", minOccurredAt: "0", maxOccurredAt: "0" }];
  }

  return [
    {
      cnt: String(matched.length),
      minOccurredAt: String(Math.min(...matched.map((r) => r.EventOccurredAt))),
      maxOccurredAt: String(Math.max(...matched.map((r) => r.EventOccurredAt))),
    },
  ];
}

/** The cutoff query: the last event per aggregate, by timestamp then id. */
function answerCutoff(rows: FakeEventLogRow[], p: QueryParams): unknown[] {
  const et: string[] = p.eventTypes ?? [];
  const aggIds: string[] = p.aggregateIds ?? [];
  const matched = rows.filter(
    (r) => r.TenantId === p.tenantId && et.includes(r.EventType) && aggIds.includes(r.AggregateId),
  );

  const byAgg = new Map<string, FakeEventLogRow>();
  for (const r of matched) {
    const k = `${r.AggregateType}|${r.AggregateId}`;
    const cur = byAgg.get(k);
    const isLater =
      !cur ||
      r.EventTimestamp > cur.EventTimestamp ||
      (r.EventTimestamp === cur.EventTimestamp && r.EventId > cur.EventId);
    if (isLater) {
      byAgg.set(k, r);
    }
  }

  return [...byAgg.values()].map((r) => ({
    aggregateType: r.AggregateType,
    aggregateId: r.AggregateId,
    cutoffEventId: r.EventId,
    cutoffTimestamp: String(r.EventTimestamp),
  }));
}

/** The load query: one ordered batch of events up to the cutoff, after the cursor. */
function answerLoad(rows: FakeEventLogRow[], p: QueryParams): unknown[] {
  const et: string[] = p.eventTypes ?? [];
  const aggIds: string[] = p.aggregateIds ?? [];
  let matched = rows.filter(
    (r) =>
      r.TenantId === p.tenantId &&
      et.includes(r.EventType) &&
      aggIds.includes(r.AggregateId) &&
      (r.EventTimestamp < p.maxCutoffTimestamp ||
        (r.EventTimestamp === p.maxCutoffTimestamp && r.EventId <= p.maxCutoffEventId)),
  );
  if (p.cursorEventId) {
    matched = matched.filter(
      (r) =>
        r.EventTimestamp > p.cursorTimestamp ||
        (r.EventTimestamp === p.cursorTimestamp && r.EventId > p.cursorEventId),
    );
  }
  matched.sort((a, b) => a.EventTimestamp - b.EventTimestamp || a.EventId.localeCompare(b.EventId));
  matched = matched.slice(0, p.batchSize ?? 5000);

  return matched.map((r) => ({
    EventId: r.EventId,
    EventTimestamp: r.EventTimestamp,
    EventOccurredAt: r.EventOccurredAt,
    EventType: r.EventType,
    EventPayload: r.EventPayload,
    EventVersion: r.EventVersion,
    TenantId: r.TenantId,
    AggregateType: r.AggregateType,
    AggregateId: r.AggregateId,
    IdempotencyKey: r.EventId,
  }));
}

/** Each query shape the replay path issues, matched by the fragment that identifies it. */
const QUERY_ANSWERS: readonly [string, (rows: FakeEventLogRow[], p: QueryParams) => unknown[]][] = [
  ["groupUniqArray(EventType)", answerDiscover],
  ["as totalEvents", (rows) => [{ totalEvents: String(rows.length) }]],
  ["AS minOccurredAt", answerOccurredAtBounds],
  ["cutoffEventId", answerCutoff],
  ["ORDER BY EventTimestamp ASC, EventId ASC", answerLoad],
];

/**
 * A faithful in-memory `event_log` behind the routed member's surface, answering the query shapes
 * the state replay path issues (discover, count, occurred-at bounds, cutoff, load), computed from
 * `rows` + params, and recording each statement's tenant — no ClickHouse container.
 */
export function makeFakeClickHouse(rows: FakeEventLogRow[]): {
  client: EventingClickHouseReplayClient;
  queries: string[];
  tenants: string[];
} {
  const queries: string[] = [];
  const tenants: string[] = [];
  const answer = ({ sql, params, tenantId }: QueryRequest): unknown[] => {
    queries.push(sql);
    tenants.push(tenantId);
    for (const [fragment, answerFor] of QUERY_ANSWERS) {
      if (sql.includes(fragment)) return answerFor(rows, params ?? {});
    }
    throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
  };
  const client = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => ({ rows: answer(request) }),
    stream: async function* (request: QueryRequest) {
      yield answer(request);
    },
  });

  return { client, queries, tenants };
}
