import { compareOrdinal } from "../utils/compareOrdinal";

export interface ReplayEvent {
  id: string;
  aggregateId: string;
  aggregateType: string;
  tenantId: string;
  createdAt: number;
  timestamp: number;
  occurredAt: number;
  type: string;
  version: string;
  idempotencyKey: string;
  data: unknown;
  metadata?: { processingTraceparent?: string };
}

export interface DiscoveredAggregate {
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
}

export interface DiscoveredAggregateWithEventTypes extends DiscoveredAggregate {
  eventTypes: string[];
}

export interface CutoffInfo {
  timestamp: number;
  eventId: string;
}

export interface OccurredAtBounds {
  minMs: number;
  maxMs: number;
}

export interface ReplayEventSource {
  discoverAffectedAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<DiscoveredAggregateWithEventTypes[]>;
  countEventsForAggregates(input: {
    eventTypes: readonly string[];
    sinceMs: number;
    tenantId?: string;
  }): Promise<number>;
  getBoundedCutoffs(input: {
    tenantId: string;
    aggregateTypes: string[];
    aggregateIds: string[];
    eventTypes: readonly string[];
  }): Promise<{
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds: OccurredAtBounds | undefined;
  }>;
  streamEventsForAggregates(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    cutoffs: Map<string, CutoffInfo>;
    occurredAtBounds?: OccurredAtBounds;
    onEvent: (event: ReplayEvent) => void | Promise<void>;
  }): Promise<{ eventsApplied: number }>;
  loadAggregateEvents(input: {
    tenantId: string;
    aggregateIds: string[];
    eventTypes: readonly string[];
    maxCutoff: CutoffInfo;
    cursor?: CutoffInfo;
    batchSize: number;
    occurredAtBounds?: OccurredAtBounds;
  }): Promise<ReplayEvent[]>;
  optimizeTables?(tenantId: string, tables: readonly string[]): Promise<void>;
}

export function compareEventPositions(left: CutoffInfo, right: CutoffInfo): number {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }
  return compareOrdinal(left.eventId, right.eventId);
}

export function maxEventPosition(positions: Iterable<CutoffInfo>): CutoffInfo {
  const iterator = positions[Symbol.iterator]();
  const first = iterator.next();
  if (first.done) {
    throw new Error("Cannot find the latest event position in an empty collection");
  }

  let latest = first.value;
  for (let next = iterator.next(); !next.done; next = iterator.next()) {
    if (compareEventPositions(next.value, latest) > 0) latest = next.value;
  }
  return latest;
}
