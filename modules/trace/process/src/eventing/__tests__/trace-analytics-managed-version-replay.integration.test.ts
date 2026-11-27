import { type Authorization, projectIdsReadBy } from "@langwatch/authorization";
import {
  type Event,
  type ProjectionStoreContext,
  type RegisteredFoldProjection,
  type ReplayEvent,
  type ReplayEventSource,
  RedisReplayMarkerChecker,
  ReplayDeferralError,
  ReplayService,
  aggregateKey,
  createTenantId,
  sealFoldProjection,
} from "@langwatch/eventing";
/**
 * The managed-version replay step over the real replay engine, fold and store (log and table in
 * memory): a pre-00133 row inside its 122 days gains its trace's managed prompt version, an older
 * row is left as it was, and a live write the replay defers still ends as the latest version.
 */
import { IDLE_REPLAY_CLAIMS_INDEX } from "@langwatch/eventing/testing";
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import type { LaneReplayer, MigrationStep } from "@langwatch/upgrade/step";
import { describe, expect, it } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { leanReplayEvent } from "../../features/projection/rules/trace-projection-lean.rules.ts";
import {
  TraceAnalyticsProjectionRepository,
  type TraceAnalyticsProjectionEntry,
} from "../../repositories/trace-analytics-projection.repository.ts";
import { managedPromptVersionReplayStep } from "../../trace.module.ts";
import {
  TRACE_ANALYTICS_PROJECTION_NAME,
  TRACE_ANALYTICS_PROJECTION_VERSION_PRE_PROMPT_VERSION,
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

const TENANT = "tenant-managed-version-replay";
const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

type Position = Pick<ReplayEvent, "timestamp" | "id">;

/** `(EventTimestamp, EventId)` order, as the event log sorts. */
function byPosition(a: Position, b: Position): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

/** A span that used the support-bot prompt at `versionId`, recorded in the log at `recordedAt`. */
function promptSpanEvent({
  eventId,
  traceId,
  spanId,
  startMs,
  versionId,
  recordedAt = startMs,
}: {
  eventId: string;
  traceId: string;
  spanId: string;
  startMs: number;
  versionId: string;
  recordedAt?: number;
}): SpanReceivedEvent {
  const event = createSpanReceivedEvent({
    eventId,
    tenantId: TENANT,
    traceId,
    spanId,
    name: "llm-call",
    occurredAt: startMs,
    startTimeUnixNano: msToUnixNano(startMs),
    endTimeUnixNano: msToUnixNano(startMs + 500),
    attributes: {
      "langwatch.prompt.id": "support-bot",
      "langwatch.prompt.version.id": versionId,
    },
  });
  return { ...event, createdAt: recordedAt };
}

/** The event as the log hands it to a replay: recorded at `createdAt`, payload parsed, leaned. */
function logged(event: SpanReceivedEvent): ReplayEvent {
  return leanReplayEvent({
    id: event.id,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    tenantId: TENANT,
    createdAt: event.createdAt,
    timestamp: event.createdAt,
    occurredAt: event.occurredAt,
    type: event.type,
    version: event.version,
    idempotencyKey: event.id,
    data: JSON.parse(JSON.stringify(event.data)),
  });
}

/** The event log: discovery since an instant on EventTimestamp, the bulk read cut at cutoffs. */
function eventLog({
  events,
  beforeStream,
}: {
  events: ReplayEvent[];
  beforeStream: () => Promise<void>;
}): ReplayEventSource {
  const of = (input: { tenantId: string; aggregateIds: string[]; eventTypes: readonly string[] }) =>
    events
      .filter(
        (event) =>
          event.tenantId === input.tenantId &&
          input.aggregateIds.includes(event.aggregateId) &&
          input.eventTypes.includes(event.type),
      )
      .toSorted(byPosition);
  return {
    discoverAffectedAggregates: async ({ eventTypes, sinceMs }) => {
      const recent = events.filter(
        (event) => eventTypes.includes(event.type) && event.timestamp >= sinceMs,
      );
      const keys = new Map(recent.map((event) => [aggregateKey(event), event]));
      return [...keys.values()].map((event) => ({
        tenantId: event.tenantId,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventTypes: [
          ...new Set(
            recent
              .filter((each) => aggregateKey(each) === aggregateKey(event))
              .map((each) => each.type),
          ),
        ],
      }));
    },
    countEventsForAggregates: async () => events.length,
    getBoundedCutoffs: async (input) => {
      const selected = of(input);
      if (selected.length === 0) return { cutoffs: new Map(), occurredAtBounds: undefined };
      const cutoffs = new Map(
        selected.map((event) => [
          aggregateKey(event),
          { timestamp: event.timestamp, eventId: event.id },
        ]),
      );
      return {
        cutoffs,
        occurredAtBounds: {
          minMs: Math.min(...selected.map((event) => event.occurredAt)),
          maxMs: Math.max(...selected.map((event) => event.occurredAt)),
        },
      };
    },
    streamEventsForAggregates: async (input) => {
      await beforeStream();
      const selected = of(input).filter((event) => {
        const cutoff = input.cutoffs.get(aggregateKey(event));
        return (
          !cutoff || byPosition(event, { timestamp: cutoff.timestamp, id: cutoff.eventId }) <= 0
        );
      });
      for (const event of selected) await input.onEvent(event);
      return { eventsApplied: selected.length };
    },
    loadAggregateEvents: async () => [],
  };
}

/** trace_analytics as its reads see it: every write kept, the latest UpdatedAt answering. */
class TraceAnalyticsTable extends TraceAnalyticsProjectionRepository {
  private readonly entries: TraceAnalyticsProjectionEntry[] = [];

  async upsert(entry: TraceAnalyticsProjectionEntry): Promise<void> {
    this.entries.push(entry);
  }

  override async upsertBatch(entries: TraceAnalyticsProjectionEntry[]): Promise<void> {
    this.entries.push(...entries);
  }

  async findByTraceId({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }) {
    const entry = this.latestEntry({ tenantIds: projectIdsReadBy(authorization), traceId });
    return entry ? { row: entry.row, appliedEventIds: entry.appliedEventIds } : null;
  }

  rowsOf(traceId: string): TraceAnalyticsRow[] {
    return this.entries.filter(({ row }) => row.traceId === traceId).map(({ row }) => row);
  }

  latest(traceId: string): TraceAnalyticsRow | undefined {
    return this.latestEntry({ tenantIds: [TENANT], traceId })?.row;
  }

  /** The views' dedup: the highest UpdatedAt, the later Version breaking a tie. */
  private latestEntry({
    tenantIds,
    traceId,
  }: {
    tenantIds: readonly string[];
    traceId: string;
  }): TraceAnalyticsProjectionEntry | undefined {
    return this.entries
      .filter(({ row }) => row.traceId === traceId && tenantIds.includes(row.tenantId))
      .toSorted(
        (a, b) =>
          b.row.updatedAtMs - a.row.updatedAtMs || b.row.version.localeCompare(a.row.version),
      )[0];
  }
}

/** A trace's row as the release before goose 00133 wrote it: folded then, no version column. */
function preColumnEntry(events: readonly SpanReceivedEvent[]): TraceAnalyticsProjectionEntry {
  const fold = TraceAnalyticsFoldProjection.create({
    store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
  const state = events.reduce((folded, event) => fold.apply(folded, event as never), fold.init());
  const writtenAt = Math.max(...events.map((event) => event.createdAt));
  return {
    row: {
      ...TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
        state,
        tenantId: TENANT,
        version: TRACE_ANALYTICS_PROJECTION_VERSION_PRE_PROMPT_VERSION,
      }),
      lastUsedPromptVersionId: "",
      createdAtMs: writtenAt,
      updatedAtMs: writtenAt,
    },
    retentionDays: 308,
    appliedEventIds: events.map((event) => event.id),
  };
}

/** The step's replayer: the real replay engine over the trace analytics lane. */
function laneReplayer({
  service,
  lane,
}: {
  service: ReplayService;
  lane: RegisteredFoldProjection;
}): LaneReplayer {
  return {
    async replayLane({ lane: name, since, dryRun }) {
      const result = await service.replay({
        projections: [lane],
        mapProjections: [],
        tenantIds: [],
        since,
        dryRun,
      });
      if (result.batchErrors > 0) throw new Error(result.firstError ?? "the replay failed");
      return {
        lane: name,
        kind: "fold",
        aggregatesReplayed: result.aggregatesReplayed,
        totalEvents: result.totalEvents,
        replayedThrough: new Date().toISOString(),
      };
    },
  };
}

/** The managed-version step over a log and a table seeded with pre-column rows. */
function deployment({
  logged: events,
  seeded,
}: {
  logged: SpanReceivedEvent[];
  seeded: TraceAnalyticsProjectionEntry[];
}) {
  const table = new TraceAnalyticsTable();
  for (const entry of seeded) void table.upsert(entry);
  const store = TraceAnalyticsStore.create({
    storage: table,
    evaluationAnalytics: memoryEvaluationAnalytics(),
    defaultRetentionDays: () => 90,
    authorize: ownProofAuthorizer,
  });
  const fold = TraceAnalyticsFoldProjection.create({
    store,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    runtime: createTestRuntime(),
  });
  const lane: RegisteredFoldProjection = {
    projectionName: TRACE_ANALYTICS_PROJECTION_NAME,
    pipelineName: "trace_processing",
    aggregateType: "trace",
    source: "pipeline",
    pauseKey: `trace_processing/projection/${TRACE_ANALYTICS_PROJECTION_NAME}`,
    kind: "fold",
    ...sealFoldProjection<TraceAnalyticsData, Event>(fold),
  };
  const keyspace = memoryRedisStore();
  const redis = memoryRedisDouble({
    store: keyspace,
    script: {
      hdel: async (key: unknown, ...fields: unknown[]) => {
        const hash = keyspace.hashes.get(String(key));
        return fields.filter((field) => hash?.delete(String(field)) ?? false).length;
      },
      hlen: async (key: unknown) => keyspace.hashes.get(String(key))?.size ?? 0,
      lpush: async () => 0,
    },
  });
  const log = events.map(logged);
  const hooks: { beforeStream: () => Promise<void> } = { beforeStream: async () => {} };
  const service = new ReplayService({
    claims: IDLE_REPLAY_CLAIMS_INDEX,
    eventSource: eventLog({ events: log, beforeStream: () => hooks.beforeStream() }),
    redis,
  });
  const step: MigrationStep = managedPromptVersionReplayStep({
    replayer: laneReplayer({ service, lane }),
    after: [],
  });
  const markers = new RedisReplayMarkerChecker(redis);

  /** The live worker's fold of one event: asks the replay markers, then folds onto its row. */
  const foldLive = async (event: SpanReceivedEvent): Promise<void> => {
    if ((await markers.check(TRACE_ANALYTICS_PROJECTION_NAME, event)) === "skip") return;
    const context = {
      aggregateId: event.aggregateId,
      tenantId: createTenantId(TENANT),
      eventId: event.id,
    } as ProjectionStoreContext;
    const { state } = await store.getWithApplied(event.aggregateId, context);
    await store.store(fold.apply(state ?? fold.init(), event as never), context);
  };

  return {
    table,
    hooks,
    foldLive,
    /** A live event reaching the log: what a later replay of the lane reads. */
    append: (event: SpanReceivedEvent) => log.push(logged(event)),
    runStep: () =>
      step.run({
        checkpoint: { resumeFrom: null, save: async () => {} },
        dryRun: false,
        signal: new AbortController().signal,
        log: { info: () => undefined, warn: () => undefined },
      }),
  };
}

describe("the trace analytics managed-version replay", () => {
  describe("given rows written before goose 00133, on each side of the step's 122 days", () => {
    const inside = promptSpanEvent({
      eventId: "event-inside",
      traceId: "aaaa0000000000000000000000000121",
      spanId: "bbbb000000000121",
      startMs: NOW - 121 * DAY_MS,
      versionId: "pv-inside",
    });
    const outside = promptSpanEvent({
      eventId: "event-outside",
      traceId: "aaaa0000000000000000000000000123",
      spanId: "bbbb000000000123",
      startMs: NOW - 123 * DAY_MS,
      versionId: "pv-outside",
    });

    /** @scenario "A trace folded before the column existed reads its version after the replay" */
    it("writes the version onto the 121-day-old row", async () => {
      const deployed = deployment({
        logged: [inside, outside],
        seeded: [preColumnEntry([inside]), preColumnEntry([outside])],
      });

      await deployed.runStep();

      expect(deployed.table.latest(inside.aggregateId)?.lastUsedPromptVersionId).toBe("pv-inside");
    });

    it("leaves the 123-day-old row as it was, with no version", async () => {
      const deployed = deployment({
        logged: [inside, outside],
        seeded: [preColumnEntry([inside]), preColumnEntry([outside])],
      });

      await deployed.runStep();

      expect(deployed.table.rowsOf(outside.aggregateId)).toHaveLength(1);
      expect(deployed.table.latest(outside.aggregateId)).toMatchObject({
        version: TRACE_ANALYTICS_PROJECTION_VERSION_PRE_PROMPT_VERSION,
        lastUsedPromptVersionId: "",
      });
    });
  });

  describe("given a trace whose later prompt span is written live", () => {
    const traceId = "aaaa0000000000000000000000000001";
    const replayed = promptSpanEvent({
      eventId: "event-replayed",
      traceId,
      spanId: "bbbb000000000001",
      startMs: NOW - 121 * DAY_MS,
      versionId: "pv-replayed",
    });
    const live = promptSpanEvent({
      eventId: "event-live",
      traceId,
      spanId: "bbbb000000000002",
      startMs: NOW - 121 * DAY_MS + 60_000,
      versionId: "pv-live",
      recordedAt: NOW,
    });

    it("ends with the live span's version when the replay defers it past its cutoff", async () => {
      const deployed = deployment({ logged: [replayed], seeded: [preColumnEntry([replayed])] });
      let deferral: unknown;
      deployed.hooks.beforeStream = async () => {
        deployed.append(live);
        deferral = await deployed.foldLive(live).catch((error: unknown) => error);
      };

      await deployed.runStep();
      const replayRow = deployed.table.latest(traceId);
      await deployed.foldLive(live);

      expect(deferral).toBeInstanceOf(ReplayDeferralError);
      expect(replayRow?.lastUsedPromptVersionId).toBe("pv-replayed");
      expect(deployed.table.latest(traceId)?.lastUsedPromptVersionId).toBe("pv-live");
    });

    it("keeps the live span's version when the live write landed before the replay", async () => {
      const deployed = deployment({ logged: [replayed], seeded: [preColumnEntry([replayed])] });
      deployed.append(live);
      await deployed.foldLive(live);

      await deployed.runStep();

      expect(deployed.table.rowsOf(traceId).length).toBeGreaterThan(2);
      expect(deployed.table.latest(traceId)?.lastUsedPromptVersionId).toBe("pv-live");
    });
  });
});
