/**
 * Parses stored `event_log` rows the way the worker reads a queued or stored event: the owning
 * pipeline's `parseEvent` (upcast, then current schema). Reads by group, a bounded sample each.
 * @see packages/eventing/specs/stored-event-parse.feature
 */
import { recordToEvent, type SealedPipelineDefinition } from "@langwatch/eventing";
import { mapEventLogRows } from "@langwatch/eventing/server";

/** One (AggregateType, EventType, EventVersion) group of a target's log and its stored count. */
export interface StoredEventGroup {
  aggregateType: string;
  eventType: string;
  eventVersion: string;
  stored: number;
}

/** The `event_log` columns a stored event is rebuilt from. */
export interface StoredEventRow {
  TenantId: string;
  AggregateType: string;
  AggregateId: string;
  EventId: string;
  EventTimestamp: number;
  EventOccurredAt: number;
  EventType: string;
  EventVersion: string;
  EventPayload: unknown;
  ProcessingTraceparent: string;
  IdempotencyKey: string;
}

export interface StoredEventSource {
  countGroups(): Promise<StoredEventGroup[]>;
  readGroup(input: { group: StoredEventGroup; limit: number }): AsyncIterable<StoredEventRow[]>;
}

/** One refused group: no payload content, only where, how many and one id to look up. */
export interface RefusedGroup {
  target: string;
  aggregateType: string;
  eventType: string;
  eventVersion: string;
  reason: "undeclared" | "refused";
  stored: number;
  sampled: number;
  refused: number;
  exampleEventId: string;
  /** Schema issue paths and codes of the example; never the values. */
  issues: string[];
}

/** The parse the worker applies to a stored type; undefined when no pipeline declares it. */
export type ParserFor = (eventType: string) => ((value: unknown) => unknown) | undefined;

/** The owner lookup `EventSourcing` applies to a queued event, over its registered definitions. */
export function parserFromDefinitions(definitions: readonly SealedPipelineDefinition[]): ParserFor {
  return (eventType) => {
    const owner = definitions.find(
      (definition) =>
        definition.aggregate.events.some((event) => event.type === eventType) ||
        definition.open((opened) =>
          (opened.upcasts?.events ?? []).some((upcast) => upcast.from.type === eventType),
        ),
    );
    return owner && ((value) => owner.open((opened) => opened.parseEvent(value)));
  };
}

/** A row rebuilt by the worker's own ClickHouse mapping, payload normalisation included. */
function readAsWorker(row: StoredEventRow): unknown {
  const [record] = mapEventLogRows({
    rows: [row],
    tenantId: row.TenantId,
    aggregateType: row.AggregateType,
    aggregateId: row.AggregateId,
  });
  if (!record) throw new Error(`event ${row.EventId} did not map`);
  return recordToEvent(record, row.AggregateId);
}

function issuesOf(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("issues" in error)) return [];
  if (!Array.isArray(error.issues)) return [];
  return error.issues.map(
    (issue: { path?: unknown[]; code?: unknown }) =>
      `${(issue.path ?? []).join(".")}:${String(issue.code)}`,
  );
}

/** Every group of one target, sampled up to `sampleSize`; a group below it is read whole. */
export async function findRefusedGroups({
  target,
  source,
  parserFor,
  sampleSize,
}: {
  target: string;
  source: StoredEventSource;
  parserFor: ParserFor;
  sampleSize: number;
}): Promise<RefusedGroup[]> {
  const refusedGroups: RefusedGroup[] = [];
  for (const group of await source.countGroups()) {
    const parse = parserFor(group.eventType);
    let sampled = 0;
    let refused = 0;
    let example: { id: string; issues: string[] } | undefined;
    for await (const rows of source.readGroup({ group, limit: sampleSize })) {
      for (const row of rows) {
        sampled += 1;
        try {
          if (!parse) throw new Error("undeclared");
          parse(readAsWorker(row));
        } catch (error) {
          refused += 1;
          example ??= { id: row.EventId, issues: parse ? issuesOf(error) : [] };
        }
      }
    }
    if (refused === 0 || !example) continue;
    refusedGroups.push({
      target,
      aggregateType: group.aggregateType,
      eventType: group.eventType,
      eventVersion: group.eventVersion,
      reason: parse ? "refused" : "undeclared",
      stored: group.stored,
      sampled,
      refused,
      exampleEventId: example.id,
      issues: example.issues,
    });
  }
  return refusedGroups;
}

/** The refused groups as a fixed-width table for a failure message. */
export function formatRefusedGroups(groups: readonly RefusedGroup[]): string {
  const header =
    "target | aggregate type | event type | version | reason | refused/sampled (stored) | example id";
  const lines = groups.map(
    (group) =>
      `${group.target} | ${group.aggregateType} | ${group.eventType} | ${group.eventVersion} | ${group.reason} | ` +
      `${group.refused}/${group.sampled} (${group.stored}) | ${group.exampleEventId} ${group.issues.join(",")}`,
  );
  return [header, ...lines].join("\n");
}
