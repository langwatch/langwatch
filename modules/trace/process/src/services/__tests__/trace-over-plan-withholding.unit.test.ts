/**
 * @vitest-environment node
 * @unit
 * Reading traces while the organization is over its plan: the plan's `overPlan` mark withholds
 * every trace that started at or after its cutoff from lists and single-trace reads.
 * @see specs/billing/over-plan-trace-withholding.feature
 */
import type { PlanProvider } from "@langwatch/entitlement-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { traceWithholdingOf } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { TraceSummaryService } from "../../features/read/services/trace-summary-read.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { VisibilityWindowService } from "../trace-visibility-window.service.ts";
import { listedRow } from "./support/trace-list-rows.support.ts";

const CUTOFF = 1_700_000_000_000;
const MINUTE = 60_000;
const authorization = ownProof({ projectId: "project-1" });
const timeRange = { from: CUTOFF - 60 * MINUTE, to: CUTOFF + 60 * MINUTE };

const overPlanPlan = { overPlan: { sinceMs: CUTOFF, members: 5, maxMembers: 2 } };
const freePlan = { overPlan: null };

/** The viewer's withholding, read through the plan the way every trace read resolves it. */
async function withholdingFor(plan: object) {
  const plans = createApiFixture<PlanProvider>({ getActivePlan: async () => plan as never });
  const window = await VisibilityWindowService.create(plans).getVisibilityWindow({
    organizationId: "org-1",
  });
  return traceWithholdingOf(window);
}

/** A trace store that answers the list and count reads by `OccurredAt` the way ClickHouse does. */
function storeHolding(occurredAts: number[]) {
  const rows = occurredAts.map((occurredAt, i) => ({
    ...listedRow({ tenantId: "project-1", traceId: `trace-${i}`, occurredAt }),
    computedInput: `question ${i}`,
  }));
  // A live window skips the upper bound, as the ClickHouse list repository does.
  const inRange = (range: { from: number; to: number; live?: boolean }) =>
    rows.filter(
      (row) => row.occurredAt >= range.from && (range.live === true || row.occurredAt <= range.to),
    );
  return {
    listAll: async ({
      timeRange: range,
    }: {
      timeRange: { from: number; to: number; live?: boolean };
    }) => ({
      rows: inRange(range),
      totalHits: inRange(range).length,
    }),
    findCount: async ({
      timeRange: range,
      since,
    }: {
      timeRange: { from: number; to: number };
      since: number;
    }) => inRange(range).filter((row) => row.occurredAt > since).length,
  };
}

function listServiceOver(occurredAts: number[]) {
  return TraceListService.create({
    discoverUpdates: { publishProjectEvent: async () => {} },
    facets: CLICKHOUSE_FACET_CATALOG,
    repository: storeHolding(occurredAts) as never,
    evaluationRuns: MemoryTraceEvaluationRunsRepository.create(),
    topicNames: { findNamesByIds: async () => new Map() },
  });
}

function summaryServiceFor(occurredAt: number) {
  return TraceSummaryService.create({
    repository: {
      findByTraceId: async () => ({
        traceId: "trace-1",
        occurredAt,
        computedInput: "what is the weather",
        computedOutput: "sunny",
        spanCount: 1,
      }),
      upsert: async () => {},
    } as never,
  });
}

const before = [CUTOFF - 30 * MINUTE, CUTOFF - 20 * MINUTE, CUTOFF - 10 * MINUTE];
const after = [CUTOFF, CUTOFF + 10 * MINUTE, CUTOFF + 20 * MINUTE, CUTOFF + 30 * MINUTE];

describe("reading traces while the organization is over its plan", () => {
  describe("given 3 traces before the cutoff and 4 after it", () => {
    /** @scenario "A trace list answers only the count of traces recorded after the cutoff" */
    it("lists the 3 earlier traces and counts the 4 withheld with the member numbers", async () => {
      const page = await listServiceOver([...before, ...after]).getList({
        authorization,
        timeRange,
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 50,
        withholding: await withholdingFor(overPlanPlan),
      });

      expect(page.items.map((item) => item.timestamp).toSorted((a, b) => a - b)).toEqual(before);
      expect(page.items.every((item) => item.input?.startsWith("question"))).toBe(true);
      expect(page.totalHits).toBe(3);
      expect(page.withheld).toEqual({ count: 4, members: 5, maxMembers: 2 });
    });

    it("keeps the later traces out of a live (rolling) window too", async () => {
      const page = await listServiceOver([...before, ...after]).getList({
        authorization,
        timeRange: { ...timeRange, live: true },
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 50,
        withholding: await withholdingFor(overPlanPlan),
      });

      expect(page.items.map((item) => item.timestamp).toSorted((a, b) => a - b)).toEqual(before);
      expect(page.totalHits).toBe(3);
    });

    it("never counts a withheld trace as new", async () => {
      const count = await listServiceOver([...before, ...after]).getNewCount({
        authorization,
        timeRange,
        since: CUTOFF - 15 * MINUTE,
        withholding: await withholdingFor(overPlanPlan),
      });

      expect(count).toBe(1);
    });
  });

  describe("given a trace recorded after the cutoff", () => {
    /** @scenario "Opening a trace recorded after the cutoff answers a handled error" */
    it("refuses the read with trace_withheld_over_plan", async () => {
      await expect(
        summaryServiceFor(CUTOFF + MINUTE).getByTraceId({
          authorization,
          traceId: "trace-1",
          withholding: await withholdingFor(overPlanPlan),
        }),
      ).rejects.toMatchObject({
        code: "trace_withheld_over_plan",
        meta: { members: 5, maxMembers: 2 },
      });
    });
  });

  describe("given a trace recorded before the cutoff", () => {
    /** @scenario "A trace recorded before the cutoff opens in full" */
    it("returns the trace with its content", async () => {
      const summary = await summaryServiceFor(CUTOFF - MINUTE).getByTraceId({
        authorization,
        traceId: "trace-1",
        withholding: await withholdingFor(overPlanPlan),
      });

      expect(summary.computedInput).toBe("what is the weather");
      expect(summary.computedOutput).toBe("sunny");
    });
  });

  describe("given a Free plan with no over-plan state", () => {
    /** @scenario "A plan without an over-plan state withholds nothing" */
    it("lists every trace and says nothing is withheld", async () => {
      const withholding = await withholdingFor(freePlan);
      const page = await listServiceOver([...before, ...after]).getList({
        authorization,
        timeRange,
        sort: { columnId: "timestamp", direction: "desc" },
        pageSize: 50,
        withholding,
      });

      expect(withholding).toEqual({ kind: "none" });
      expect(page.items).toHaveLength(7);
      expect(page.withheld ?? null).toBeNull();
    });
  });
});
