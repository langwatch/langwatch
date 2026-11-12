import {
  createTenantId,
  type ProjectionStoreContext,
  RedisCachedFoldStore,
} from "@langwatch/eventing";
import {
  EVALUATION_OUTCOME_RECORDED_EVENT_TYPE,
  EVALUATION_OUTCOME_RECORDED_EVENT_VERSION_LATEST,
  type EvaluationOutcomeRecordedEvent,
  TOPIC_ASSIGNED_EVENT_TYPE,
  TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
  type TopicAssignedEvent,
} from "@langwatch/trace-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ownProofAuthorizer } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { MemoryTraceAnalyticsRepository } from "../../repositories/memory/memory.trace-analytics-projection.repository.ts";
import { MemoryTraceEvaluationAnalyticsRepository } from "../../repositories/memory/memory.trace-evaluation-analytics.repository.ts";
import {
  EVALUATIONS_PER_TRACE_MAX,
  traceEvaluationRowsDigest,
  traceEvaluationRowsOf,
} from "../../rules/trace-evaluation-analytics.rules.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsRow,
} from "../trace-derived.projection.ts";
import { TraceAnalyticsStore } from "../trace-derived.store.ts";
import { memoryEvaluationAnalytics } from "./trace-evaluation-analytics.fixtures.ts";
import { createTestRuntime } from "./trace-summary-test.fixtures.ts";

const TENANT = "tenant-evaluation-rows";
const TRACE_ID = "trace-evaluation-rows";
const ANCHOR_MS = 1_760_000_000_000;

const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
});

const context = {
  aggregateId: TRACE_ID,
  tenantId: createTenantId(TENANT),
} as ProjectionStoreContext;

/** The trace as its own events leave it, before any evaluation. */
function traceState(): TraceAnalyticsData {
  return {
    ...projection.init(),
    traceId: TRACE_ID,
    spanCount: 1,
    storageAnchorMs: ANCHOR_MS,
    occurredAt: ANCHOR_MS,
    createdAt: ANCHOR_MS,
    updatedAt: ANCHOR_MS,
    topicId: "topic-billing",
  };
}

function outcome({
  evaluationOccurredAt,
  sourceEventId,
  passed,
  evaluationId = "evaluation-1",
}: {
  evaluationOccurredAt: number;
  sourceEventId: string;
  passed: boolean;
  evaluationId?: string;
}): EvaluationOutcomeRecordedEvent {
  return {
    id: `trace-event-${sourceEventId}`,
    type: EVALUATION_OUTCOME_RECORDED_EVENT_TYPE,
    version: EVALUATION_OUTCOME_RECORDED_EVENT_VERSION_LATEST,
    tenantId: createTenantId(TENANT),
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    createdAt: evaluationOccurredAt,
    occurredAt: ANCHOR_MS,
    data: {
      evaluationId,
      evaluatorName: "Faithfulness",
      isGuardrail: false,
      status: "processed",
      passed,
      label: null,
      evaluationOccurredAt,
      sourceEventId,
    },
  };
}

function topicAssigned(topicId: string): TopicAssignedEvent {
  return {
    id: `topic-${topicId}`,
    type: TOPIC_ASSIGNED_EVENT_TYPE,
    version: TOPIC_ASSIGNED_EVENT_VERSION_LATEST,
    tenantId: createTenantId(TENANT),
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    createdAt: ANCHOR_MS + 5_000,
    occurredAt: ANCHOR_MS,
    data: {
      topicId,
      topicName: topicId,
      subtopicId: null,
      subtopicName: null,
      isIncremental: false,
    },
  };
}

function fold(state: TraceAnalyticsData, event: { type: string }): TraceAnalyticsData {
  return projection.apply(state, event as never);
}

function project(state: TraceAnalyticsData): TraceAnalyticsRow {
  return TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
    state,
    tenantId: TENANT,
    version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  });
}

function digestOf(state: TraceAnalyticsData): string {
  return traceEvaluationRowsDigest(traceEvaluationRowsOf({ state, traceRow: project(state) }));
}

const FIRST = outcome({
  evaluationOccurredAt: ANCHOR_MS + 60_000,
  sourceEventId: "evaluation-event-1",
  passed: false,
});
const RERUN = outcome({
  evaluationOccurredAt: ANCHOR_MS + 120_000,
  sourceEventId: "evaluation-event-2",
  passed: true,
});

/** A trace analytics store over memory, and the evaluation rows it writes first. */
function harness() {
  const rows = MemoryTraceEvaluationAnalyticsRepository.create();
  let clock = ANCHOR_MS + 1_000_000;
  const store = TraceAnalyticsStore.create({
    storage: MemoryTraceAnalyticsRepository.create(),
    evaluationAnalytics: memoryEvaluationAnalytics({ storage: rows, now: () => clock++ }),
    defaultRetentionDays: () => 90,
    authorize: ownProofAuthorizer,
  });
  const readBack = async (): Promise<TraceAnalyticsData> => {
    const { state } = await store.getWithApplied(TRACE_ID, context);
    if (!state) throw new Error("the trace analytics row was not written");
    return state;
  };
  return { store, rows, readBack };
}

describe("the trace analytics fold's evaluation outcomes", () => {
  describe("given a trace whose fold holds an evaluation's outcome", () => {
    /** @scenario "The fresher outcome of an evaluation wins" */
    it("keeps the fresher outcome when an older one arrives after it", () => {
      const state = fold(fold(traceState(), RERUN), FIRST);

      expect(state.evaluations?.["evaluation-1"]).toMatchObject({
        passed: true,
        sourceEventId: "evaluation-event-2",
      });
    });
  });

  describe("given a trace whose fold holds the most evaluations it keeps", () => {
    let full: TraceAnalyticsData;
    beforeEach(() => {
      full = traceState();
      for (let index = 0; index < EVALUATIONS_PER_TRACE_MAX; index++) {
        full = fold(
          full,
          outcome({
            evaluationId: `evaluation-${index}`,
            evaluationOccurredAt: ANCHOR_MS + index,
            sourceEventId: `evaluation-event-${index}`,
            passed: true,
          }),
        );
      }
    });

    /** @scenario "A trace's fold refuses a new evaluation past 200 and keeps every one it holds" */
    it("refuses a new evaluation and still updates one it holds", () => {
      const withNew = fold(
        full,
        outcome({
          evaluationId: "evaluation-new",
          evaluationOccurredAt: ANCHOR_MS + EVALUATIONS_PER_TRACE_MAX,
          sourceEventId: "evaluation-event-new",
          passed: true,
        }),
      );
      const updated = fold(
        withNew,
        outcome({
          evaluationId: "evaluation-0",
          evaluationOccurredAt: ANCHOR_MS + EVALUATIONS_PER_TRACE_MAX,
          sourceEventId: "evaluation-event-0-rerun",
          passed: false,
        }),
      );

      expect(Object.keys(withNew.evaluations ?? {})).toHaveLength(EVALUATIONS_PER_TRACE_MAX);
      expect(withNew.evaluations).not.toHaveProperty("evaluation-new");
      expect(updated.evaluations?.["evaluation-0"]).toMatchObject({ passed: false });
    });

    /** @scenario "A trace's fold refuses a new evaluation past 200 and keeps every one it holds" */
    it("leaves every written evaluation's row live when a new one is refused", async () => {
      const { store, rows, readBack } = harness();
      await store.store(full, context);

      await store.store(
        fold(
          await readBack(),
          outcome({
            evaluationId: "evaluation-new",
            evaluationOccurredAt: ANCHOR_MS + EVALUATIONS_PER_TRACE_MAX,
            sourceEventId: "evaluation-event-new",
            passed: true,
          }),
        ),
        context,
      );

      const live = rows.liveRows().map(({ row }) => row.evaluationId);
      expect(live).toHaveLength(EVALUATIONS_PER_TRACE_MAX);
      expect(live).toContain("evaluation-0");
      expect(live).not.toContain("evaluation-new");
    });
  });
});

describe("TraceAnalyticsStore's evaluation rows", () => {
  describe("given a trace with no evaluation rows", () => {
    /** @scenario "A new evaluation writes one row" */
    it("writes the evaluation's row once at revision 1 and records the rows' digest", async () => {
      const { store, rows, readBack } = harness();
      const state = fold(traceState(), FIRST);

      await store.store(state, context);

      expect(rows.inserted).toHaveLength(1);
      expect(rows.inserted[0]).toMatchObject({ sign: 1, revision: 1 });
      expect(rows.inserted[0]?.row).toMatchObject({
        evaluationId: "evaluation-1",
        traceOccurredAtMs: ANCHOR_MS,
        topicId: "topic-billing",
        passed: false,
        origin: null,
      });
      expect((await readBack()).evaluationRowsDigest).toBe(digestOf(state));
    });
  });

  describe("given a trace whose evaluation row is stored", () => {
    /** @scenario "A copied trace column change writes a retraction pair" */
    it("retracts the stored row byte for byte and writes the new one at the next revision", async () => {
      const { store, rows, readBack } = harness();
      await store.store(fold(traceState(), FIRST), context);
      const [stored] = rows.inserted;

      await store.store(fold(await readBack(), topicAssigned("topic-refunds")), context);

      expect(rows.inserted).toHaveLength(3);
      expect(rows.inserted[1]).toEqual({ ...stored, sign: -1 });
      expect(rows.inserted[2]).toMatchObject({ sign: 1, revision: 2 });
      expect(rows.liveRows().map(({ row }) => row.topicId)).toEqual(["topic-refunds"]);
    });

    /** @scenario "Unchanged rows write nothing" */
    it("neither reads the live rows nor writes when nothing changed", async () => {
      const { store, rows, readBack } = harness();
      await store.store(fold(traceState(), FIRST), context);
      const liveRead = vi.spyOn(rows, "findLiveRows");

      await store.store(await readBack(), context);

      expect(liveRead).not.toHaveBeenCalled();
      expect(rows.inserted).toHaveLength(1);
    });

    /** @scenario "A replay from scratch writes no duplicate" */
    it("writes nothing when a replay folds the trace again from no state", async () => {
      const { store, rows } = harness();
      await store.store(fold(traceState(), FIRST), context);

      await store.store(fold(traceState(), FIRST), context);

      expect(rows.inserted).toHaveLength(1);
      expect(rows.liveRows()).toHaveLength(1);
    });
  });

  describe("given an orphan retraction and a doubled row of one evaluation, and a state with no recorded digest", () => {
    let rows: MemoryTraceEvaluationAnalyticsRepository;
    let state: TraceAnalyticsData;
    let traceRow: TraceAnalyticsRow;
    beforeEach(() => {
      rows = harness().rows;
      state = fold(traceState(), FIRST);
      traceRow = project(state);
    });

    /** @scenario "An orphan retraction and a doubled row converge to one live row" */
    it("nets the current content to one and every other group to zero", async () => {
      const [current] = traceEvaluationRowsOf({ state, traceRow });
      if (!current) throw new Error("the state has no evaluation row");
      const stale = { ...current, topicId: "topic-old" };
      const base = { updatedAtMs: ANCHOR_MS, retentionDays: 90 };
      rows.inserted.push(
        { row: stale, sign: -1, revision: 1, ...base },
        { row: current, sign: 1, revision: 2, ...base },
        { row: current, sign: 1, revision: 2, ...base },
      );

      await memoryEvaluationAnalytics({ storage: rows }).writeBatch([{ state, context, traceRow }]);

      const sums = new Map<string, number>();
      for (const write of rows.inserted) {
        const key = JSON.stringify([write.row.topicId, write.revision, write.updatedAtMs]);
        sums.set(key, (sums.get(key) ?? 0) + write.sign);
      }
      expect(Object.fromEntries(sums)).toEqual({
        [JSON.stringify(["topic-old", 1, ANCHOR_MS])]: 0,
        [JSON.stringify(["topic-billing", 2, ANCHOR_MS])]: 1,
      });
    });

    it("writes nothing for a clean live row", async () => {
      const store = memoryEvaluationAnalytics({ storage: rows });
      await store.writeBatch([{ state, context, traceRow }]);

      await store.writeBatch([{ state, context, traceRow }]);

      expect(rows.inserted).toHaveLength(1);
    });
  });

  describe("given a trace whose fold state is held in the fold cache after each store", () => {
    /** @scenario "A cached fold state flipped back writes the original row again" */
    it("leaves exactly one live row, carrying A's content, after A then B then A", async () => {
      const { store, rows } = harness();
      const cache = new Map<string, string>();
      const redis = {
        get: async (key: string) => cache.get(key) ?? null,
        set: async (key: string, value: string) => void cache.set(key, value),
      };
      const cached = new RedisCachedFoldStore(store, redis as never, {
        keyPrefix: "trace_analytics",
        ttlSeconds: 300,
      });
      const current = async (): Promise<TraceAnalyticsData> => {
        const { state } = await cached.getWithApplied(TRACE_ID, context);
        if (!state) throw new Error("the trace analytics state was not found");
        return state;
      };
      // A cold cache: the first read decodes the durable row, digest of A included.
      await store.store(fold(traceState(), FIRST), context);

      await cached.store(fold(await current(), topicAssigned("topic-refunds")), context);
      await cached.store(fold(await current(), topicAssigned("topic-billing")), context);

      expect(rows.liveRows().map(({ row }) => row.topicId)).toEqual(["topic-billing"]);
    });
  });

  describe("given an evaluation row written whose trace row write was lost", () => {
    /** @scenario "A crash between the two writes heals" */
    it("writes no evaluation row again and records the rows' digest on the trace", async () => {
      const { store, rows, readBack } = harness();
      await store.store(fold(traceState(), FIRST), context);
      const rerun = fold(await readBack(), RERUN);
      await memoryEvaluationAnalytics({ storage: rows }).writeBatch([
        { state: rerun, context, traceRow: project(rerun) },
      ]);
      const written = rows.inserted.length;

      await store.store(rerun, context);

      expect(rows.inserted).toHaveLength(written);
      expect(rows.liveRows().map(({ row }) => row.passed)).toEqual([true]);
      expect((await readBack()).evaluationRowsDigest).toBe(digestOf(rerun));
    });
  });
});
