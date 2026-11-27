import {
  type Event,
  type RegisteredFoldProjection,
  type ReplayEvent,
  type ReplayEventSource,
  ReplayService,
  aggregateKey,
  sealFoldProjection,
} from "@langwatch/eventing";
/**
 * The trace_analytics row the widget-columns replay writes for a trace is the same whether its
 * events came from the bulk read or, that read over ClickHouse's per-query memory limit, in pages.
 * Spec: specs/upgrade/projection-replay-step.feature
 */
import { IDLE_REPLAY_CLAIMS_INDEX } from "@langwatch/eventing/testing";
import { memoryRedisDouble } from "@langwatch/test-harness/client-doubles/redis";
import { describe, expect, it } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { leanReplayEvent } from "../../features/projection/rules/trace-projection-lean.rules.ts";
import {
  TraceAnalyticsProjectionRepository,
  type TraceAnalyticsProjectionEntry,
} from "../../repositories/trace-analytics-projection.repository.ts";
import {
  TRACE_ANALYTICS_PROJECTION_NAME,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
} from "../trace-derived.projection.ts";
import { TraceAnalyticsStore } from "../trace-derived.store.ts";
import { memoryEvaluationAnalytics } from "./trace-evaluation-analytics.fixtures.ts";
import {
  createSpanReceivedEvent,
  createTestRuntime,
  msToUnixNano,
} from "./trace-summary-test.fixtures.ts";

const TENANT = "tenant-paged-replay";
const TRACE_ID = "aaaa0000000000000000000000000009";
const BASE_MS = 1_760_000_000_000;

/** ClickHouse's refusal for one statement over its own memory limit, as the client raises it. */
const queryMemoryLimitError = () =>
  Object.assign(new Error("Query memory limit exceeded: would use 4.76 GiB, maximum: 4.66 GiB"), {
    code: "241",
  });

/** A small trace's spans as the event log hands them to replay: parsed payloads, leaned. */
function traceEvents(): ReplayEvent[] {
  return Array.from({ length: 3 }, (_, n) => {
    const at = BASE_MS + n * 1_000;
    const event = createSpanReceivedEvent({
      eventId: `event-${n}`,
      tenantId: TENANT,
      traceId: TRACE_ID,
      spanId: `bbbb00000000000${n}`,
      parentSpanId: n === 0 ? null : "bbbb000000000000",
      name: n === 0 ? "root" : `llm-call-${n}`,
      occurredAt: at,
      startTimeUnixNano: msToUnixNano(at),
      endTimeUnixNano: msToUnixNano(at + 500),
      attributes: { "gen_ai.request.model": "gpt-5-mini" },
    });
    return leanReplayEvent({
      id: event.id,
      aggregateId: event.aggregateId,
      aggregateType: event.aggregateType,
      tenantId: TENANT,
      createdAt: at,
      timestamp: at,
      occurredAt: at,
      type: event.type,
      version: event.version,
      idempotencyKey: event.id,
      data: JSON.parse(JSON.stringify(event.data)),
    });
  });
}

type Position = Pick<ReplayEvent, "timestamp" | "id">;

/** `(EventTimestamp, EventId)` order, as the event log sorts. */
const byPosition = (a: Position, b: Position) =>
  a.timestamp - b.timestamp || compareIds(a.id, b.id);

function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The event log, its bulk read over the memory limit when told; counts each kind of read. */
function eventLog(events: ReplayEvent[], { bulkOverMemory }: { bulkOverMemory: boolean }) {
  const reads = { bulk: 0, pages: 0 };
  const of = (input: { tenantId: string; aggregateIds: string[]; eventTypes: readonly string[] }) =>
    events
      .filter(
        (event) =>
          event.tenantId === input.tenantId &&
          input.aggregateIds.includes(event.aggregateId) &&
          input.eventTypes.includes(event.type),
      )
      .toSorted(byPosition);
  const source: ReplayEventSource = {
    discoverAffectedAggregates: async ({ eventTypes }) => {
      const matching = events.filter((event) => eventTypes.includes(event.type));
      const keys = new Map(matching.map((event) => [aggregateKey(event), event]));
      return [...keys.values()].map((event) => ({
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventTypes: [...new Set(matching.map((each) => each.type))],
      }));
    },
    countEventsForAggregates: async () => events.length,
    getBoundedCutoffs: async (input) => {
      const selected = of(input);
      const last = selected.at(-1);
      if (!last) return { cutoffs: new Map(), occurredAtBounds: undefined };
      return {
        cutoffs: new Map([[aggregateKey(last), { timestamp: last.timestamp, eventId: last.id }]]),
        occurredAtBounds: {
          minMs: Math.min(...selected.map((event) => event.occurredAt)),
          maxMs: Math.max(...selected.map((event) => event.occurredAt)),
        },
      };
    },
    streamEventsForAggregates: async (input) => {
      reads.bulk++;
      if (bulkOverMemory) throw queryMemoryLimitError();
      const selected = of(input);
      for (const event of selected) await input.onEvent(event);
      return { eventsApplied: selected.length };
    },
    loadAggregateEvents: async (input) => {
      reads.pages++;
      const upTo = { timestamp: input.maxCutoff.timestamp, id: input.maxCutoff.eventId };
      const after = input.cursor && { timestamp: input.cursor.timestamp, id: input.cursor.eventId };
      return of(input)
        .filter((event) => byPosition(event, upTo) <= 0)
        .filter((event) => !after || byPosition(event, after) > 0)
        .slice(0, input.batchSize);
    },
  };
  return { source, reads };
}

/** The trace_analytics port, keeping each row the store hands it as ClickHouse would get it. */
class WrittenRows extends TraceAnalyticsProjectionRepository {
  readonly rows: TraceAnalyticsRow[] = [];

  async upsert(entry: TraceAnalyticsProjectionEntry): Promise<void> {
    this.rows.push(entry.row);
  }

  override async upsertBatch(entries: TraceAnalyticsProjectionEntry[]): Promise<void> {
    for (const entry of entries) this.rows.push(entry.row);
  }

  async findByTraceId() {
    return null;
  }
}

/** The widget-columns lane: the real trace analytics fold over the real store. */
function traceAnalyticsLane(storage: WrittenRows): RegisteredFoldProjection {
  const fold = TraceAnalyticsFoldProjection.create({
    store: TraceAnalyticsStore.create({
      storage,
      evaluationAnalytics: memoryEvaluationAnalytics(),
      defaultRetentionDays: () => 90,
      authorize: ownProofAuthorizer,
    }),
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
  return {
    projectionName: TRACE_ANALYTICS_PROJECTION_NAME,
    pipelineName: "trace_processing",
    aggregateType: "trace",
    source: "pipeline",
    pauseKey: `trace_processing/projection/${TRACE_ANALYTICS_PROJECTION_NAME}`,
    kind: "fold",
    ...sealFoldProjection<TraceAnalyticsData, Event>(fold),
  };
}

/** One replay of the lane; the rows it wrote and the reads it made. */
async function replayTrace({ bulkOverMemory }: { bulkOverMemory: boolean }) {
  const storage = new WrittenRows();
  const { source, reads } = eventLog(traceEvents(), { bulkOverMemory });
  const service = new ReplayService({
    claims: IDLE_REPLAY_CLAIMS_INDEX,
    eventSource: source,
    redis: memoryRedisDouble({
      script: { hdel: async () => 0, hlen: async () => 0, lpush: async () => 0 },
    }),
  });
  const result = await service.replay({
    projections: [traceAnalyticsLane(storage)],
    mapProjections: [],
    tenantIds: [],
    since: "1970-01-01T00:00:00Z",
    dryRun: false,
  });
  return { rows: storage.rows, reads, result };
}

/** A row less its fold-time stamps, which every rebuild re-stamps with the clock. */
function withoutFoldTime({ createdAtMs, updatedAtMs, ...row }: TraceAnalyticsRow) {
  void createdAtMs;
  void updatedAtMs;
  return row;
}

describe("the trace analytics widget-columns replay", () => {
  describe("given a small trace whose bulk read is over the per-query memory limit", () => {
    /** @scenario "A paged trace writes the trace_analytics row its bulk read writes" */
    it("writes the same trace_analytics row from its pages as from its bulk read", async () => {
      const bulk = await replayTrace({ bulkOverMemory: false });
      const paged = await replayTrace({ bulkOverMemory: true });

      expect(bulk.reads).toEqual({ bulk: 1, pages: 0 });
      expect(paged.reads.bulk).toBe(1);
      expect(paged.reads.pages).toBeGreaterThan(0);
      expect(paged.result).toMatchObject({ batchErrors: 0, totalEvents: 3 });
      expect(bulk.rows).toHaveLength(1);
      expect(bulk.rows[0]).toMatchObject({ tenantId: TENANT, traceId: TRACE_ID });
      expect(paged.rows.map(withoutFoldTime)).toEqual(bulk.rows.map(withoutFoldTime));
    });
  });
});
