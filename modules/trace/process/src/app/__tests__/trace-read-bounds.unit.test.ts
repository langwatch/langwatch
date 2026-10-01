import { createApiFixture } from "@langwatch/api-fixture";
/**
 * @vitest-environment node
 * The tier-effective request bounds: page sizes clamp to the plan's bound,
 * id arrays above the plan's bound refuse with the typed error.
 */
import type { ProjectApi } from "@langwatch/project-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type { Evaluation, TracesForProjectResult } from "@langwatch/trace-contract";
import { TraceIdsTooManyError } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceService as TraceTreeService } from "../../services/trace.service.ts";
import {
  TraceApp,
  type TraceEditOverlayStore,
  type TraceSummaryReader,
  type TracesListReader,
  type TracesSessionGroupsReader,
  type TracesSpanReader,
} from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";
import { createTraceTestRequestBounds } from "./trace-bounds.fixture.ts";

const PROTECTIONS = { canSeeCosts: true };
const QUERY = { projectId: "project-1", startDate: 1_000, endDate: 2_000 };

function tracePage(): TracesForProjectResult {
  return { groups: [], totalHits: 0, traceChecks: {} };
}

function harness(tier: "free" | "paid" | "enterprise") {
  const getAllTracesForProject = vi.fn<TraceLegacyRead["getAllTracesForProject"]>(async () =>
    tracePage(),
  );
  const getTracesWithSpans = vi.fn<TraceLegacyRead["getTracesWithSpans"]>(async () => []);
  const getTracesWithSpansByThreadIds = vi.fn<TraceLegacyRead["getTracesWithSpansByThreadIds"]>(
    async () => [],
  );
  const getEvaluationsMultiple = vi.fn<TraceLegacyRead["getEvaluationsMultiple"]>(
    async () => ({}) as Record<string, Evaluation[]>,
  );
  const read: Partial<TraceLegacyRead> = {
    getAllTracesForProject,
    getTracesWithSpans,
    getTracesWithSpansByThreadIds,
    getEvaluationsMultiple,
  };
  const summary: TraceSummaryReader = { getByTraceId: async () => ({}) as never };

  const app = TraceApp.create({
    storedObjects: createApiFixture<StoredObjectApi>(),
    traces: {
      existence: {
        findExistingTraceIds: async ({ traceIds }) => [...traceIds],
        countUsage: async () => ({ traces: 0, spans: 0 }),
      },
      read: read as TraceLegacyRead,
      spans: {} as TracesSpanReader,
      summary,
      list: {} as TracesListReader,
      sessionGroups: {} as TracesSessionGroupsReader,
      tree: {} as TraceTreeService,
      logRecords: { getLogsByTraceId: async () => [] },
      canonicalisation: {} as never,
      editOverlay: {} as TraceEditOverlayStore,
      changeTraceName: async () => undefined,
    },
    topics: {} as never,
    broadcast: {
      getTenantEmitter: () => {
        throw new Error("no read in this suite subscribes");
      },
      cleanupTenantEmitter: () => undefined,
    },
    evaluations: {} as never,
    codingAgents: {} as never,
    share: {} as never,
    projects: {
      getOrganizationId: async (projectId: string) => `organization-of-${projectId}`,
    } as ProjectApi,
    requestBounds: createTraceTestRequestBounds(tier),
    exportBounds: null,
  });

  return {
    app,
    getAllTracesForProject,
    getTracesWithSpans,
    getTracesWithSpansByThreadIds,
    getEvaluationsMultiple,
  };
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `trace-${index}`);

describe("trace read bounds", () => {
  describe("when a caller names a page size", () => {
    it.each([
      ["free", 1500, 1000],
      ["paid", 2500, 2000],
      ["enterprise", 4500, 4000],
    ] as const)(
      "clamps a %s-tier caller's pageSize %i to %i",
      async (tier, requested, expected) => {
        const { app, getAllTracesForProject } = harness(tier);

        await app.listTraces({
          query: { ...QUERY, pageSize: requested },
          protections: PROTECTIONS,
        });

        expect(getAllTracesForProject.mock.calls[0]?.[0]).toMatchObject({ pageSize: expected });
      },
    );

    it("leaves an absent page size on the repository default", async () => {
      const { app, getAllTracesForProject } = harness("free");

      await app.listTraces({ query: { ...QUERY }, protections: PROTECTIONS });

      expect(getAllTracesForProject.mock.calls[0]?.[0]).not.toHaveProperty("pageSize");
    });

    it("clamps the sample read's explicit page size too", async () => {
      const { app, getAllTracesForProject } = harness("free");

      await app.readSampleTraces({ query: QUERY, protections: PROTECTIONS, pageSize: 5000 });

      expect(getAllTracesForProject.mock.calls[0]?.[0]).toMatchObject({ pageSize: 1000 });
    });
  });

  describe("when a caller names trace or thread ids", () => {
    it.each([
      ["free", 1001],
      ["paid", 2001],
      ["enterprise", 4001],
    ] as const)("refuses a %s-tier caller asking for %i trace ids", async (tier, count) => {
      const { app, getTracesWithSpans } = harness(tier);

      await expect(
        app.readTracesWithSpans({
          projectId: "project-1",
          traceIds: ids(count),
          protections: PROTECTIONS,
        }),
      ).rejects.toBeInstanceOf(TraceIdsTooManyError);
      expect(getTracesWithSpans).not.toHaveBeenCalled();
    });

    it("reads exactly the tier number of trace ids", async () => {
      const { app, getTracesWithSpans } = harness("paid");

      await app.readTracesWithSpans({
        projectId: "project-1",
        traceIds: ids(2000),
        protections: PROTECTIONS,
      });

      expect(getTracesWithSpans).toHaveBeenCalledWith({
        projectId: "project-1",
        traceIds: ids(2000),
        protections: PROTECTIONS,
        opts: { full: true },
      });
    });

    it("refuses thread ids above the tier the same way", async () => {
      const { app, getTracesWithSpansByThreadIds } = harness("free");

      await expect(
        app.readThreadsTraces({
          projectId: "project-1",
          threadIds: ids(1001),
          protections: PROTECTIONS,
        }),
      ).rejects.toBeInstanceOf(TraceIdsTooManyError);
      expect(getTracesWithSpansByThreadIds).not.toHaveBeenCalled();
    });

    /** @scenario "A page of conversations never loses a trace to the read's ceiling" */
    it("passes the caller's ceiling to the thread read, sized by the threads asked for", async () => {
      const { app, getTracesWithSpansByThreadIds } = harness("enterprise");
      const threadIds = ids(200);

      await app.readThreadsTraces({
        projectId: "project-1",
        threadIds,
        protections: PROTECTIONS,
        maxTraces: threadIds.length * 1_000,
      });

      expect(getTracesWithSpansByThreadIds).toHaveBeenCalledWith({
        projectId: "project-1",
        threadIds,
        protections: PROTECTIONS,
        opts: { full: true, maxTraces: 200_000 },
      });
    });

    it("refuses the evaluations-multiple read above the tier", async () => {
      const { app, getEvaluationsMultiple } = harness("enterprise");

      await expect(
        app.readEvaluations({
          projectId: "project-1",
          traceIds: ids(4001),
          protections: PROTECTIONS,
        }),
      ).rejects.toMatchObject({ name: "TraceIdsTooManyError", meta: { maxIds: 4000 } });
      expect(getEvaluationsMultiple).not.toHaveBeenCalled();
    });
  });
});
