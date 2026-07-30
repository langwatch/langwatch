import { describe, expect, it, vi } from "vitest";
import type { AggregateType } from "../../domain/aggregateType";
import type { ProjectionStoreContext } from "../../projections/projectionStoreContext";
import { createMockFoldProjectionStore } from "../../services/__tests__/testHelpers";
import { TIME_LOCAL_AGGREGATE_TYPES } from "../../stores/rehydrationWindow";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsData,
  EvaluationAnalyticsFoldProjection,
} from "../evaluation-processing/projections/evaluationAnalytics.foldProjection";
import { EvaluationAnalyticsStore } from "../evaluation-processing/projections/evaluationAnalytics.store";
import {
  type TraceAnalyticsData,
  TraceAnalyticsFoldProjection,
} from "../trace-processing/projections/traceAnalytics.foldProjection";
import { TraceAnalyticsStore } from "../trace-processing/projections/traceAnalytics.store";
import { TraceSummaryFoldProjection } from "../trace-processing/projections/traceSummary.foldProjection";

/**
 * Structural contracts behind `trustAbsentMiss` (the always-write change) and the
 * applied-event-id watermark (ADR-066). Each assertion here is a claim some
 * OTHER file's correctness silently depends on; these tests exist so breaking
 * the pairing fails a build instead of double-counting production data.
 */

/**
 * Aggregate type each fold is registered under — mirrors the
 * `.withAggregateType(...)` binding in the pipeline definitions
 * (trace-processing/pipeline.ts, evaluation-processing/pipeline.ts). If a
 * registration moves, move it here too; the point of the duplication is that
 * this file fails when someone re-binds a trusted fold to a type whose
 * lifetime cannot back the trust.
 */
const stubStore = () => createMockFoldProjectionStore<never>();
const FOLDS: Array<{
  name: string;
  aggregateType: AggregateType;
  projection: {
    options?: {
      trustAbsentMiss?: boolean;
      readWindow?: { widthMs: number };
      refoldOnStoreMiss?: boolean;
    };
  };
  /** The concrete store class the pipeline pairs with this fold, if any. */
  storeClass?: { prototype: { getWithApplied?: unknown } };
}> = [
  {
    name: "traceSummary",
    aggregateType: "trace",
    projection: new TraceSummaryFoldProjection({ store: stubStore() }),
    // TraceSummaryStore is get()-only — consistent, because this fold
    // declares no refoldOnStoreMiss for a miss discriminator to feed.
  },
  {
    name: "traceAnalytics",
    aggregateType: "trace",
    projection: new TraceAnalyticsFoldProjection({ store: stubStore() }),
    storeClass: TraceAnalyticsStore,
  },
  {
    name: "evaluationAnalytics",
    aggregateType: "evaluation",
    projection: new EvaluationAnalyticsFoldProjection({ store: stubStore() }),
    storeClass: EvaluationAnalyticsStore,
  },
];

describe("fold projection contracts", () => {
  describe("given a fold declares trustAbsentMiss", () => {
    const trusted = FOLDS.filter(
      (fold) => fold.projection.options?.trustAbsentMiss === true,
    );

    it("covers the folds this contract was written for", () => {
      expect(trusted.map((fold) => fold.name).sort()).toEqual([
        "evaluationAnalytics",
        "traceAnalytics",
        "traceSummary",
      ]);
    });

    /**
     * Trusting a windowed absence claims the row can never sit outside the
     * window, a bet on the aggregate's LIFETIME, the same one
     * `rehydrationLowerBoundMs` makes when bounding event reads. A fold bound
     * to a long-lived aggregate (a coding-agent session spanning weeks) may
     * declare a readWindow for pruning, but it must NOT trust the window's
     * misses: its rows legitimately outlive any width.
     *
     * The router refuses such a registration outright
     * (projectionRouter.registrationGuard.unit.test.ts); this asserts the
     * shipped folds are on the right side of that refusal.
     */
    /** @scenario a trusted fold's windowed read is backed by a time-local lifetime */
    it("binds only to TIME_LOCAL aggregate types when it also declares a readWindow", () => {
      for (const fold of trusted) {
        if (fold.projection.options?.readWindow === undefined) continue;
        expect(
          TIME_LOCAL_AGGREGATE_TYPES.has(fold.aggregateType),
          `${fold.name} trusts a windowed absence but "${fold.aggregateType}" is not time-local`,
        ).toBe(true);
      }
    });

    /**
     * A get()-only store can never answer `undecodable` (the executor stamps
     * its nulls `absent`), so under trustAbsentMiss its `refoldOnStoreMiss`
     * would never fire again: dead config that reads like a safety net.
     *
     * The pairing is only visible here. By the time a fold reaches the router
     * its store is wrapped in `RedisCachedFoldStore`, which declares
     * `getWithApplied` whatever the durable tier behind it can do, so
     * registration cannot tell the two apart.
     */
    /** @scenario trusting absence must not orphan the undecodable net */
    it("pairs refoldOnStoreMiss with a store that can distinguish undecodable", () => {
      for (const fold of trusted) {
        if (fold.projection.options?.refoldOnStoreMiss !== true) continue;
        expect(
          typeof fold.storeClass?.prototype.getWithApplied,
          `${fold.name} keeps refoldOnStoreMiss but its store cannot report an undecodable miss`,
        ).toBe("function");
      }
    });
  });

  describe("given the trace-analytics store commits a state", () => {
    const context = (appliedEventIds?: string[]): ProjectionStoreContext => ({
      aggregateId: "trace-1",
      tenantId: "tenant-1" as ProjectionStoreContext["tenantId"],
      ...(appliedEventIds ? { appliedEventIds } : {}),
    });

    const signalState = (): TraceAnalyticsData => ({
      ...(new TraceAnalyticsFoldProjection({
        store: stubStore(),
      }).init() as TraceAnalyticsData),
      traceId: "trace-1",
      spanCount: 2,
      occurredAt: 1_700_000_000_000,
      storageAnchorMs: 1_700_000_000_000,
    });

    const dimensionOnlyState = (): TraceAnalyticsData => ({
      ...(new TraceAnalyticsFoldProjection({
        store: stubStore(),
      }).init() as TraceAnalyticsData),
      traceId: "trace-1",
      topicId: "topic-9",
      storageAnchorMs: 1_700_000_000_000,
    });

    const makeRepo = () => ({
      upsert: vi.fn(async (..._args: unknown[]) => undefined),
      findByTraceIdWithApplied: vi.fn(async () => null),
    });

    /**
     * The executor dedups a redelivered batch against the ids persisted NEXT
     * TO the row. A store that drops them re-applies the batch on the next
     * cold-cache retry: silent double-count, no error anywhere.
     */
    /** @scenario the redelivery watermark survives the write path */
    it("persists the applied-event-id watermark next to the row", async () => {
      const repo = makeRepo();
      const store = new TraceAnalyticsStore(repo as never);

      await store.store(signalState(), context(["evt-1", "evt-2"]));

      expect(repo.upsert).toHaveBeenCalledTimes(1);
      expect(repo.upsert.mock.calls[0]![2]).toEqual(["evt-1", "evt-2"]);
    });

    /** @scenario the watermark round-trips through the read-back */
    it("reads the same watermark back with the state", async () => {
      const repo = makeRepo();
      const store = new TraceAnalyticsStore(repo as never);
      await store.store(signalState(), context(["evt-1"]));
      const writtenRow = (repo.upsert.mock.calls[0] as unknown[])[0];
      repo.findByTraceIdWithApplied.mockResolvedValue({
        row: writtenRow,
        appliedEventIds: ["evt-1"],
      } as never);

      const back = await store.getWithApplied("trace-1", context());

      expect(back.state).not.toBeNull();
      expect(back.appliedEventIds).toEqual(["evt-1"]);
      expect(back.miss).toBeUndefined();
    });

    /**
     * `trustAbsentMiss` on the fold is only sound while this holds. If a
     * write-gate returns, absence goes back to meaning "maybe declined" and
     * the executor overwrites live dimension state with init().
     */
    /** @scenario absence is authoritative because nothing is ever gated out */
    it("writes a dimension-only state too, flagged HasSignal=false", async () => {
      const repo = makeRepo();
      const store = new TraceAnalyticsStore(repo as never);

      await store.store(dimensionOnlyState(), context());

      expect(repo.upsert).toHaveBeenCalledTimes(1);
      const row = (repo.upsert.mock.calls[0] as unknown[])[0] as {
        hasSignal: boolean;
      };
      expect(row.hasSignal).toBe(false);
    });

    it("flags a state with real telemetry HasSignal=true", async () => {
      const repo = makeRepo();
      const store = new TraceAnalyticsStore(repo as never);

      await store.store(signalState(), context());

      const row = (repo.upsert.mock.calls[0] as unknown[])[0] as {
        hasSignal: boolean;
      };
      expect(row.hasSignal).toBe(true);
    });
  });

  describe("given the evaluation-analytics store commits a state", () => {
    const context = (appliedEventIds?: string[]): ProjectionStoreContext => ({
      aggregateId: "eval-1",
      tenantId: "tenant-1" as ProjectionStoreContext["tenantId"],
      ...(appliedEventIds ? { appliedEventIds } : {}),
    });

    const makeRepo = () => ({
      upsert: vi.fn(async (..._args: unknown[]) => undefined),
      findByEvaluationIdWithApplied: vi.fn(async () => null),
    });

    const bareState = (): EvaluationAnalyticsData =>
      new EvaluationAnalyticsFoldProjection({
        store: stubStore(),
      }).init() as EvaluationAnalyticsData;

    /** @scenario the watermark survives the eval write path too */
    it("persists the applied-event-id watermark next to the row", async () => {
      const repo = makeRepo();
      const store = new EvaluationAnalyticsStore(repo as never);

      await store.store(bareState(), context(["evt-9"]));

      expect(repo.upsert).toHaveBeenCalledTimes(1);
      expect(repo.upsert.mock.calls[0]![2]).toEqual(["evt-9"]);
    });

    /**
     * The old gate refused a state with no identity; the aggregate-id stamp
     * makes one, so nothing is gated and absence stays authoritative.
     */
    /** @scenario no state is unwritable, identity falls back to the aggregate id */
    it("writes a state with no identity of its own, stamped from the aggregate id", async () => {
      const repo = makeRepo();
      const store = new EvaluationAnalyticsStore(repo as never);

      await store.store(bareState(), context());

      expect(repo.upsert).toHaveBeenCalledTimes(1);
      const row = (repo.upsert.mock.calls[0] as unknown[])[0] as {
        evaluationId: string;
        version: string;
      };
      expect(row.evaluationId).toBe("eval-1");
      expect(row.version).toBe(EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST);
    });
  });
});
