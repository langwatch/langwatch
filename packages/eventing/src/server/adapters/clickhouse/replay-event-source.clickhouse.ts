import { createLogger } from "@langwatch/observability";

import {
  type CutoffInfo,
  type DiscoveredAggregateWithEventTypes,
  type OccurredAtBounds,
  REPLAY_ALL_TENANTS,
  type ReplayEvent,
  type ReplayEventSource,
} from "../../../replay/replayEventSource.ts";
import { isAnyMemoryLimitExceeded } from "../../../services/errorHandling.ts";
import type { EventingClickHouseReplayClient } from "../../clickhouse-client-resolver.ts";
import { type EventLogIdIndex, eventLogOccurredRange } from "../../tables/event-log-id-index.ts";

/** ClickHouse event_log row shape. */
export interface ClickHouseEventRow {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventType: string;
  EventTimestamp: number;
  EventOccurredAt?: number;
  EventVersion?: string;
  EventPayload: string;
  ProcessingTraceparent?: string;
  IdempotencyKey?: string;
}

/**
 * The ADR-022 lean, supplied by the composition root.
 */
export type ReplayEventLean = (event: ReplayEvent) => ReplayEvent;

/**
 * Materialize a raw `event_log` row into the event shape every replay path
 * consumes — including the ADR-022 lean, applied here exactly once (see the
 * comment on the return).
 */
export function rowToEvent(row: ClickHouseEventRow, lean: ReplayEventLean): ReplayEvent {
  const data =
    row.EventPayload && row.EventPayload.length > 0 ? JSON.parse(row.EventPayload) : null;

  const occurredAt =
    row.EventOccurredAt && row.EventOccurredAt > 0 ? row.EventOccurredAt : row.EventTimestamp;

  const event: ReplayEvent = {
    id: row.EventId,
    aggregateId: row.AggregateId,
    aggregateType: row.AggregateType,
    tenantId: row.TenantId,
    createdAt: row.EventTimestamp,
    timestamp: row.EventTimestamp,
    occurredAt,
    type: row.EventType,
    version: row.EventVersion ?? "2025-01-01",
    idempotencyKey: row.IdempotencyKey ?? row.EventId,
    data,
    metadata: row.ProcessingTraceparent
      ? { processingTraceparent: row.ProcessingTraceparent }
      : undefined,
  };

  // ADR-022: lean ONCE, at materialization — the same interposition live
  // dispatch applies before its handlers. Every replay path consumes events
  // through this function, so a single lean here replaces one lean per
  // (event × projection) inside the accumulators while keeping replayed
  // output byte-identical to live.
  return lean(event);
}

/**
 * Discover aggregates with events of the given types since a timestamp.
 * When tenantId is omitted, discovers across ALL tenants.
 */
export async function discoverAffectedAggregates({
  client,
  eventTypes,
  sinceMs,
  tenantId,
}: {
  client: EventingClickHouseReplayClient;
  eventTypes: readonly string[];
  sinceMs: number;
  tenantId?: string;
}): Promise<DiscoveredAggregateWithEventTypes[]> {
  const tenantFilter = tenantId ? "AND TenantId = {tenantId:String}" : "";
  const params: Record<string, unknown> = {
    eventTypes: [...eventTypes],
    sinceMs,
  };
  if (tenantId) params.tenantId = tenantId;

  const { rows } = await client.query<DiscoveredAggregateWithEventTypes>({
    tenantId: tenantId ?? REPLAY_ALL_TENANTS,
    sql: `
      SELECT
        TenantId AS tenantId,
        AggregateType AS aggregateType,
        AggregateId AS aggregateId,
        groupUniqArray(EventType) AS eventTypes
      FROM event_log
      WHERE EventType IN ({eventTypes:Array(String)})
        AND EventTimestamp >= {sinceMs:UInt64}
        ${tenantFilter}
      GROUP BY TenantId, AggregateType, AggregateId
      ORDER BY TenantId
    `,
    params,
    // Replay discovery: a replay is asked for one tenant or for every tenant, and the tenant
    // predicate is present only in the first case.
    SKIP_TENANT_CHECK: true,
    // The window is on EventTimestamp (recording time), which the EventOccurredAt partition key
    // does not carry: a late event can have occurred any number of weeks before it was recorded.
    SKIP_COLD_SCAN_CHECK: true,
  });

  return rows;
}

/**
 * The tenants holding any of the event types since a timestamp, one row each, so a replay lists
 * them before it discovers any aggregate. Read on the shared server: a private dataplane's tenants
 * are not listed here (plan pr-7536 F-5, MIG-REPLAY-SCALE risk R1).
 */
export async function discoverTenants({
  client,
  eventTypes,
  sinceMs,
}: {
  client: EventingClickHouseReplayClient;
  eventTypes: readonly string[];
  sinceMs: number;
}): Promise<string[]> {
  const { rows } = await client.query<{ tenantId: string }>({
    tenantId: REPLAY_ALL_TENANTS,
    sql: `
      SELECT DISTINCT TenantId AS tenantId
      FROM event_log
      WHERE EventType IN ({eventTypes:Array(String)})
        AND EventTimestamp >= {sinceMs:UInt64}
      ORDER BY TenantId
    `,
    params: { eventTypes: [...eventTypes], sinceMs },
    // Replay tenant listing: a replay lists the tenants holding a lane's events before it discovers
    // each tenant's aggregates under that tenant.
    SKIP_TENANT_CHECK: true,
    // The window is on EventTimestamp (recording time), which the EventOccurredAt partition key
    // does not carry: a late event can have occurred any number of weeks before it was recorded.
    SKIP_COLD_SCAN_CHECK: true,
  });
  return rows.map((row) => row.tenantId);
}

/**
 * Count total events for discovered aggregates (ALL history, not just since window).
 */
export async function countEventsForAggregates({
  client,
  eventTypes,
  sinceMs,
  tenantId,
}: {
  client: EventingClickHouseReplayClient;
  eventTypes: readonly string[];
  sinceMs: number;
  tenantId?: string;
}): Promise<number> {
  const params: Record<string, unknown> = {
    eventTypes: [...eventTypes],
    sinceMs,
  };
  if (tenantId) params.tenantId = tenantId;

  const { rows } = await client.query<{ totalEvents: string }>({
    tenantId: tenantId ?? REPLAY_ALL_TENANTS,
    sql: `
      SELECT count() as totalEvents
      FROM event_log
      WHERE ${tenantId ? "TenantId = {tenantId:String} AND" : ""} EventType IN ({eventTypes:Array(String)})
        AND (AggregateType, AggregateId) IN (
          SELECT DISTINCT AggregateType, AggregateId
          FROM event_log
          WHERE ${tenantId ? "TenantId = {tenantId:String} AND" : ""} EventType IN ({eventTypes:Array(String)})
            AND EventTimestamp >= {sinceMs:UInt64}
        )
    `,
    params,
    // Replay discovery: a replay is asked for one tenant or for every tenant, and the tenant
    // predicate is present only in the first case.
    SKIP_TENANT_CHECK: true,
    // Counts every event of the discovered aggregates across all history, as replay applies them.
    SKIP_COLD_SCAN_CHECK: true,
  });

  return parseInt(rows[0]?.totalEvents ?? "0", 10);
}

/**
 * SQL fragment + params for an optional occurred-at pruning predicate. Rows with no occurred time
 * (0) are always kept: the index's bounds leave them out, the event log's own include them.
 */
function occurredAtPredicate(bounds?: OccurredAtBounds): {
  sql: string;
  params: Record<string, unknown>;
} {
  if (!bounds) return { sql: "", params: {} };
  return {
    sql: `AND (
          EventOccurredAt = 0
          OR (
            EventOccurredAt >= {minOccurredAtMs:UInt64}
            AND EventOccurredAt <= {maxOccurredAtMs:UInt64}
          )
        )`,
    params: { minOccurredAtMs: bounds.minMs, maxOccurredAtMs: bounds.maxMs },
  };
}

/**
 * Compute the `EventOccurredAt` min/max over ALL events of the given aggregates (no event-type
 * filter, full history). With the event log index trusted for every type, its span answers; an
 * aggregate it has not seen reads the event log itself, unbounded, as before the index.
 */
export async function getAggregateOccurredAtBounds({
  client,
  tenantId,
  aggregateTypes,
  aggregateIds,
  eventLogIndex,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateTypes: string[];
  aggregateIds: string[];
  eventLogIndex?: EventLogIdIndex | undefined;
}): Promise<OccurredAtBounds | undefined> {
  if (aggregateIds.length === 0) return undefined;
  const indexed = await eventLogOccurredRange({
    index: eventLogIndex,
    read: "replay",
    tenantId,
    aggregateTypes,
    aggregateIds,
  });
  if (indexed !== null) return { minMs: indexed.fromMs, maxMs: indexed.toMs };

  const { rows } = await client.query<{
    cnt: string;
    minOccurredAt: string;
    maxOccurredAt: string;
  }>({
    tenantId,
    sql: `
      SELECT
        count() AS cnt,
        min(EventOccurredAt) AS minOccurredAt,
        max(EventOccurredAt) AS maxOccurredAt
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND AggregateType IN ({aggregateTypes:Array(String)})
        AND AggregateId IN ({aggregateIds:Array(String)})
    `,
    params: { tenantId, aggregateTypes, aggregateIds },
    // This read finds the bounds the batch's later reads prune by, so it must see all history.
    SKIP_COLD_SCAN_CHECK: true,
  });

  const row = rows[0];
  if (!row || parseInt(row.cnt, 10) === 0) return undefined;

  return {
    minMs: parseInt(row.minOccurredAt, 10),
    maxMs: parseInt(row.maxOccurredAt, 10),
  };
}

/**
 * Get cutoff event info for a batch of aggregates in one query. `occurredAtBounds` (when
 * available) enables partition pruning; pass bounds from {@link getAggregateOccurredAtBounds}
 * so no event of these aggregates can fall outside the range.
 */
export async function batchGetCutoffEventIds({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
  occurredAtBounds,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  occurredAtBounds?: OccurredAtBounds;
}): Promise<Map<string, CutoffInfo>> {
  const pruning = occurredAtPredicate(occurredAtBounds);
  const { rows } = await client.query<{
    aggregateType: string;
    aggregateId: string;
    cutoffEventId: string;
    cutoffTimestamp: string;
  }>({
    tenantId,
    sql: `
      SELECT
        AggregateType AS aggregateType,
        AggregateId AS aggregateId,
        argMax(EventId, (EventTimestamp, EventId)) AS cutoffEventId,
        max(EventTimestamp) AS cutoffTimestamp
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND EventType IN ({eventTypes:Array(String)})
        AND AggregateId IN ({aggregateIds:Array(String)})
        ${pruning.sql}
      GROUP BY AggregateType, AggregateId
    `,
    params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      ...pruning.params,
    },
  });

  const map = new Map<string, CutoffInfo>();
  for (const row of rows) {
    map.set(`${tenantId}:${row.aggregateType}:${row.aggregateId}`, {
      timestamp: parseInt(row.cutoffTimestamp, 10),
      eventId: row.cutoffEventId,
    });
  }
  return map;
}

/**
 * Compute occurred-at bounds for a batch of aggregates, then fetch their cutoff event IDs
 * bounded by those bounds — the shared "bounds first, then cutoffs" sequence every replay batch
 * path runs before loading events.
 */
export async function getBoundedCutoffs({
  client,
  tenantId,
  aggregateTypes,
  aggregateIds,
  eventTypes,
  eventLogIndex,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateTypes: string[];
  aggregateIds: string[];
  eventTypes: readonly string[];
  eventLogIndex?: EventLogIdIndex | undefined;
}): Promise<{
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds: OccurredAtBounds | undefined;
}> {
  const occurredAtBounds = await getAggregateOccurredAtBounds({
    client,
    tenantId,
    aggregateTypes,
    aggregateIds,
    eventLogIndex,
  });
  if (!occurredAtBounds) {
    return {
      cutoffs: new Map<string, CutoffInfo>(),
      occurredAtBounds: undefined,
    };
  }

  const cutoffs = await batchGetCutoffEventIds({
    client,
    tenantId,
    aggregateIds,
    eventTypes,
    occurredAtBounds,
  });
  return { cutoffs, occurredAtBounds };
}

/** How much one event read of a replay batch may sort and send: its events and payload bytes. */
export interface ReplayReadBudget {
  maxEvents: number;
  maxPayloadBytes: number;
}

/**
 * A read sorts every row it sends, payloads included, before the first row leaves the server, so
 * a batch reads in slices well under a small server's memory. Spec: projection-replay-step.feature.
 */
export const REPLAY_READ_BUDGET: ReplayReadBudget = {
  maxEvents: 20_000,
  maxPayloadBytes: 64 * 1024 * 1024,
};

const logger = createLogger("langwatch:event-sourcing:replay-event-source");

/**
 * Stream every event a replay batch must apply for a set of aggregates, invoking `onEvent` per row
 * in per-aggregate `(EventTimestamp, EventId)` order: in reads sized to `budget` by each
 * aggregate's event count and payload bytes, an aggregate always whole within one read.
 */
export async function streamEventsForAggregatesBulk({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
  cutoffs,
  occurredAtBounds,
  lean,
  onEvent,
  budget = REPLAY_READ_BUDGET,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds?: OccurredAtBounds;
  lean: ReplayEventLean;
  onEvent: (event: ReplayEvent) => void | Promise<void>;
  budget?: ReplayReadBudget;
}): Promise<{ eventsApplied: number }> {
  if (aggregateIds.length === 0) return { eventsApplied: 0 };

  // Two aggregate types may share an id; `AggregateId IN` reads both, so each id is read once.
  const distinctIds = [...new Set(aggregateIds)];
  const read = { client, tenantId, eventTypes, cutoffs, occurredAtBounds, lean, onEvent };
  const sizes = await readAggregateSizes({ ...read, aggregateIds: distinctIds });
  let eventsApplied = 0;
  for (const slice of sliceByBudget({ aggregateIds: distinctIds, sizes, budget })) {
    eventsApplied += await streamSliceOrHalves({ ...read, aggregateIds: slice });
  }
  return { eventsApplied };
}

interface AggregateSize {
  events: number;
  payloadBytes: number;
}

/**
 * Each aggregate's event count and payload bytes, aggregated without a sort; on a server that
 * serves `length` from the String's size subcolumn it reads no payload bytes at all.
 */
async function readAggregateSizes({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
  occurredAtBounds,
}: {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  occurredAtBounds?: OccurredAtBounds | undefined;
}): Promise<Map<string, AggregateSize>> {
  const pruning = occurredAtPredicate(occurredAtBounds);
  const { rows } = await client.query<{
    aggregateId: string;
    events: string | number;
    payloadBytes: string | number;
  }>({
    tenantId,
    sql: `
      SELECT AggregateId AS aggregateId,
             count() AS events,
             sum(length(EventPayload)) AS payloadBytes
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND EventType IN ({eventTypes:Array(String)})
        AND AggregateId IN ({aggregateIds:Array(String)})
        ${pruning.sql}
      GROUP BY AggregateId
    `,
    params: { tenantId, eventTypes: [...eventTypes], aggregateIds, ...pruning.params },
  });
  return new Map(
    rows.map((row) => [
      row.aggregateId,
      { events: Number(row.events), payloadBytes: Number(row.payloadBytes) },
    ]),
  );
}

/**
 * The batch's aggregates in order, cut into slices within the budget; an aggregate over it alone
 * is a slice of its own. An aggregate with no sized row is read with the slice it falls in.
 */
export function sliceByBudget({
  aggregateIds,
  sizes,
  budget,
}: {
  aggregateIds: readonly string[];
  sizes: ReadonlyMap<string, AggregateSize>;
  budget: ReplayReadBudget;
}): string[][] {
  const slices: string[][] = [];
  let slice: string[] = [];
  let held = { events: 0, payloadBytes: 0 };
  for (const aggregateId of aggregateIds) {
    const size = sizes.get(aggregateId) ?? { events: 0, payloadBytes: 0 };
    const grown = {
      events: held.events + size.events,
      payloadBytes: held.payloadBytes + size.payloadBytes,
    };
    const over = grown.events > budget.maxEvents || grown.payloadBytes > budget.maxPayloadBytes;
    if (slice.length > 0 && over) {
      slices.push(slice);
      slice = [aggregateId];
      held = size;
    } else {
      slice.push(aggregateId);
      held = grown;
    }
  }
  if (slice.length > 0) slices.push(slice);
  return slices;
}

/** Events a slice's read applied, and whether it handed one on at all (set before the call). */
interface SliceProgress {
  count: number;
  handedOn: boolean;
}

export interface SliceRead {
  client: EventingClickHouseReplayClient;
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  cutoffs: Map<string, CutoffInfo>;
  occurredAtBounds?: OccurredAtBounds | undefined;
  lean: ReplayEventLean;
  onEvent: (event: ReplayEvent) => void | Promise<void>;
}

/**
 * One slice's read; one over a memory limit before it handed on any event is read again as halves,
 * down to a single aggregate, whose failure is the batch's. A read that handed on one rethrows.
 */
export async function streamSliceOrHalves(read: SliceRead): Promise<number> {
  const applied: SliceProgress = { count: 0, handedOn: false };
  try {
    return await streamSlice({ ...read, applied });
  } catch (error) {
    if (applied.handedOn || read.aggregateIds.length < 2 || !isAnyMemoryLimitExceeded(error)) {
      throw error;
    }
    logger.warn(
      { tenantId: read.tenantId, aggregates: read.aggregateIds.length, error },
      "Replay read over a memory limit before it applied an event; reading it as halves",
    );
    const middle = Math.ceil(read.aggregateIds.length / 2);
    let eventsApplied = 0;
    for (const half of [read.aggregateIds.slice(0, middle), read.aggregateIds.slice(middle)]) {
      eventsApplied += await streamSliceOrHalves({ ...read, aggregateIds: half });
    }
    return eventsApplied;
  }
}

async function streamSlice({
  client,
  tenantId,
  aggregateIds,
  eventTypes,
  cutoffs,
  occurredAtBounds,
  lean,
  onEvent,
  applied,
}: SliceRead & { applied: SliceProgress }): Promise<number> {
  const pruning = occurredAtPredicate(occurredAtBounds);
  const batches = client.stream<ClickHouseEventRow>({
    tenantId,
    sql: `
      SELECT EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload,
             EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent,
             IdempotencyKey
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND EventType IN ({eventTypes:Array(String)})
        AND AggregateId IN ({aggregateIds:Array(String)})
        ${pruning.sql}
      ORDER BY AggregateId, EventTimestamp ASC, EventId ASC
    `,
    params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      ...pruning.params,
    },
  });

  for await (const rows of batches) {
    for (const row of rows) {
      const key = `${tenantId}:${row.AggregateType}:${row.AggregateId}`;
      if (isRowBeyondCutoff(row, cutoffs.get(key))) continue;

      applied.handedOn = true;
      const maybePromise = onEvent(rowToEvent(row, lean));
      if (maybePromise instanceof Promise) await maybePromise;
      applied.count++;
    }
  }
  return applied.count;
}

/** Whether a row falls past its aggregate's cutoff (skip it, live owns it). */
function isRowBeyondCutoff(row: ClickHouseEventRow, cutoff: CutoffInfo | undefined): boolean {
  if (!cutoff) return false;
  const eventTimestamp =
    typeof row.EventTimestamp === "string" ? parseInt(row.EventTimestamp, 10) : row.EventTimestamp;
  if (eventTimestamp > cutoff.timestamp) return true;
  return eventTimestamp === cutoff.timestamp && row.EventId > cutoff.eventId;
}

interface EventPage {
  tenantId: string;
  aggregateIds: string[];
  eventTypes: readonly string[];
  maxCutoff: CutoffInfo;
  cursor?: CutoffInfo;
  batchSize: number;
  occurredAtBounds?: OccurredAtBounds;
}

/** From `FROM` to `ORDER BY`: the events after `cursor` up to `maxCutoff`, in event order. */
function eventPageWhere({
  tenantId,
  aggregateIds,
  eventTypes,
  maxCutoff,
  cursor,
  batchSize,
  occurredAtBounds,
}: EventPage): { sql: string; params: Record<string, unknown> } {
  const pruning = occurredAtPredicate(occurredAtBounds);
  return {
    sql: `
    FROM event_log
    WHERE TenantId = {tenantId:String}
      AND EventType IN ({eventTypes:Array(String)})
      AND AggregateId IN ({aggregateIds:Array(String)})
      AND (
        EventTimestamp < {maxCutoffTimestamp:UInt64}
        OR (
          EventTimestamp = {maxCutoffTimestamp:UInt64}
          AND EventId <= {maxCutoffEventId:String}
        )
      )
      ${
        cursor
          ? `AND (
        EventTimestamp > {cursorTimestamp:UInt64}
        OR (
          EventTimestamp = {cursorTimestamp:UInt64}
          AND EventId > {cursorEventId:String}
        )
      )`
          : ""
      }
      ${pruning.sql}
    ORDER BY EventTimestamp ASC, EventId ASC
  `,
    params: {
      tenantId,
      eventTypes: [...eventTypes],
      aggregateIds,
      maxCutoffTimestamp: maxCutoff.timestamp,
      maxCutoffEventId: maxCutoff.eventId,
      ...(cursor
        ? {
            cursorTimestamp: cursor.timestamp,
            cursorEventId: cursor.eventId,
          }
        : {}),
      batchSize,
      ...pruning.params,
    },
  };
}

const PAGE_LIMIT = "LIMIT {batchSize:UInt32}";

/**
 * A page decompresses every payload granule holding one of its rows, whole; parallel streams read
 * one such granule per part at once and multiply its memory. One stream bounds a page near one
 * granule plus its own rows.
 */
const PAGE_READ_SETTINGS = { max_threads: 1 } as const;

/** One sized row of a page: its `(EventTimestamp, EventId)` position and its payload bytes. */
export interface SizedRow {
  timestamp: number;
  eventId: string;
  payloadBytes: number;
}

/** The rows at each position in turn, as the row count through it and the bytes they hold. */
function positionGroups(rows: readonly SizedRow[]): { end: number; bytes: number }[] {
  const groups: { end: number; bytes: number }[] = [];
  for (const [index, row] of rows.entries()) {
    const previous = rows[index - 1];
    const last = groups.at(-1);
    const tied = previous?.timestamp === row.timestamp && previous.eventId === row.eventId;
    if (last && tied) {
      last.end = index + 1;
      last.bytes += row.payloadBytes;
    } else {
      groups.push({ end: index + 1, bytes: row.payloadBytes });
    }
  }
  return groups;
}

/**
 * Leading rows of a page within `maxPayloadBytes`, ended only between positions so tied copies
 * stay together; a first position over the cap is its own page. `truncated`: the LIMIT cut the
 * read, so its last position, which may hold unseen rows, waits for the next page.
 */
export function rowsWithinPayload({
  rows,
  maxPayloadBytes,
  truncated,
}: {
  rows: readonly SizedRow[];
  maxPayloadBytes: number;
  truncated: boolean;
}): number {
  const groups = positionGroups(rows);
  const whole = truncated && groups.length > 1 ? groups.slice(0, -1) : groups;
  let held = 0;
  let end = 0;
  for (const group of whole) {
    held += group.bytes;
    if (held > maxPayloadBytes && end > 0) return end;
    end = group.end;
  }
  return end;
}

/**
 * The last position of a page whose payloads stay within `maxPayloadBytes`, from the rows'
 * positions and payload sizes alone, so this read sorts no payload. Undefined: the page is empty.
 */
async function payloadBoundedEnd({
  client,
  page,
  maxPayloadBytes,
}: {
  client: EventingClickHouseReplayClient;
  page: EventPage;
  maxPayloadBytes: number;
}): Promise<CutoffInfo | undefined> {
  const where = eventPageWhere(page);
  const { rows } = await client.query<{
    EventTimestamp: string | number;
    EventId: string;
    payloadBytes: string | number;
  }>({
    tenantId: page.tenantId,
    sql: `SELECT EventTimestamp, EventId, length(EventPayload) AS payloadBytes ${where.sql}
    ${PAGE_LIMIT}`,
    params: where.params,
    settings: PAGE_READ_SETTINGS,
  });
  const fit = rowsWithinPayload({
    rows: rows.map((row) => ({
      timestamp: Number(row.EventTimestamp),
      eventId: row.EventId,
      payloadBytes: Number(row.payloadBytes),
    })),
    maxPayloadBytes,
    truncated: rows.length >= page.batchSize,
  });
  const end = rows[fit - 1];
  return end && { timestamp: Number(end.EventTimestamp), eventId: end.EventId };
}

/**
 * Load events for a batch of aggregates up to a max cutoff, with cursor-based pagination. With
 * `maxPayloadBytes`, a first read of positions and sizes ends the page where its payloads fit, and
 * the load reads that range whole, with no LIMIT to cut a tied position the cursor would then skip.
 */
export async function batchLoadAggregateEvents({
  client,
  maxPayloadBytes,
  lean,
  ...page
}: EventPage & {
  client: EventingClickHouseReplayClient;
  maxPayloadBytes?: number;
  lean: ReplayEventLean;
}): Promise<ReplayEvent[]> {
  const maxCutoff =
    maxPayloadBytes === undefined
      ? page.maxCutoff
      : await payloadBoundedEnd({ client, page, maxPayloadBytes });
  if (!maxCutoff) return [];

  const where = eventPageWhere({ ...page, maxCutoff });
  const { rows } = await client.query<ClickHouseEventRow>({
    tenantId: page.tenantId,
    sql: `
    SELECT EventId, EventTimestamp, EventOccurredAt, EventType, EventPayload,
           EventVersion, TenantId, AggregateType, AggregateId, ProcessingTraceparent,
           IdempotencyKey
    ${where.sql}
    ${maxPayloadBytes === undefined ? PAGE_LIMIT : ""}`,
    params: where.params,
    settings: PAGE_READ_SETTINGS,
  });

  return rows.map((row) => rowToEvent(row, lean));
}

/**
 * The canonical `event_log` reader replay runs against, over the routed ClickHouse member, which
 * places each statement on its tenant's server. Reads only. It never dispatches to subscribers or
 * process managers, and offers no seam that could — replay must not re-fire side effects.
 */
export class EventingClickHouseReplayEventSource implements ReplayEventSource {
  private readonly clickhouse: EventingClickHouseReplayClient;
  private readonly lean: ReplayEventLean;
  private readonly eventLogIndex: EventLogIdIndex | undefined;
  private readonly readBudget: ReplayReadBudget;

  constructor(deps: {
    clickhouse: EventingClickHouseReplayClient;
    lean: ReplayEventLean;
    /** Bounds each batch by the aggregate index once it is ready on the tenant's target. */
    eventLogIndex?: EventLogIdIndex;
    /** How much one event read may hold; defaults to `REPLAY_READ_BUDGET`. */
    readBudget?: ReplayReadBudget;
  }) {
    this.clickhouse = deps.clickhouse;
    this.lean = deps.lean;
    this.eventLogIndex = deps.eventLogIndex;
    this.readBudget = deps.readBudget ?? REPLAY_READ_BUDGET;
  }

  discoverTenants(input: { eventTypes: readonly string[]; sinceMs: number }): Promise<string[]> {
    return discoverTenants({ client: this.clickhouse, ...input });
  }

  discoverAffectedAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<DiscoveredAggregateWithEventTypes[]> {
    return discoverAffectedAggregates({ client: this.clickhouse, ...input });
  }

  countEventsForAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<number> {
    return countEventsForAggregates({ client: this.clickhouse, ...input });
  }

  getBoundedCutoffs(input: {
    tenantId: string;
    aggregateTypes: string[];
    aggregateIds: string[];
    eventTypes: readonly string[];
  }) {
    return getBoundedCutoffs({
      client: this.clickhouse,
      eventLogIndex: this.eventLogIndex,
      ...input,
    });
  }

  streamEventsForAggregates(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds?: OccurredAtBounds;
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }): Promise<{ eventsApplied: number }> {
    return streamEventsForAggregatesBulk({
      client: this.clickhouse,
      lean: this.lean,
      budget: this.readBudget,
      ...input,
    });
  }

  loadAggregateEvents(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    maxCutoff: CutoffInfo;
    cursor?: CutoffInfo;
    batchSize: number;
    maxPayloadBytes?: number;
    occurredAtBounds?: OccurredAtBounds;
  }): Promise<ReplayEvent[]> {
    return batchLoadAggregateEvents({ client: this.clickhouse, lean: this.lean, ...input });
  }

  async optimizeTables(tenantId: string, tables: readonly string[]): Promise<void> {
    for (const table of tables) {
      await this.clickhouse.command({
        tenantId,
        sql: "OPTIMIZE TABLE {table:Identifier}",
        params: { table },
        // Replay's post-rebuild OPTIMIZE TABLE names a table, not a tenant.
        SKIP_TENANT_CHECK: true,
      });
    }
  }
}
