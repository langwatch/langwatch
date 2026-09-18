import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { TopicApi } from "@langwatch/topic-contract";
/**
 * @vitest-environment node
 * Trace application rules: full resolution on content-consuming reads,
 * partition-pruning hints, visibility-window verdicts. See specs/traces #4991.
 */
import type {
  Evaluation,
  TraceCanonicalisationService,
  TraceSummaryData,
  TraceWithGuardrail,
  TracesForProjectResult,
} from "@langwatch/trace-contract";
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

function traceRow(traceId: string): TraceWithGuardrail {
  return {
    trace_id: traceId,
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: 1_000, inserted_at: 1_100, updated_at: 1_100 },
    spans: [],
    lastGuardrail: undefined,
  };
}

function tracePage(rows: TraceWithGuardrail[]): TracesForProjectResult {
  return { groups: rows.length > 0 ? [rows] : [], totalHits: rows.length, traceChecks: {} };
}

/**
 * A summary carrying only the field the visibility verdict reads. The stored
 * shape has forty more, and naming them here would say that the verdict
 * depends on them.
 */
function summaryRow(redacted: boolean): TraceSummaryData {
  const readByTheVerdict: Partial<TraceSummaryData> = {
    redactedByVisibilityWindow: redacted,
  };
  return readByTheVerdict as TraceSummaryData;
}

type ReadCall = { name: string; args: unknown[] };

/**
 * The trace reads this suite drives, and nothing else. Every other
 * collaborator is left off: a reach for one throws on the missing property,
 * the loud failure this suite wants.
 */
function harness(
  reads: Partial<{
    findById: TraceLegacyRead["findById"];
    getEvaluationsMultiple: TraceLegacyRead["getEvaluationsMultiple"];
    getAllTracesForProject: TraceLegacyRead["getAllTracesForProject"];
    getTracesWithSpans: TraceLegacyRead["getTracesWithSpans"];
    getByTraceId: TraceSummaryReader["getByTraceId"];
  }> = {},
) {
  const tryGetById = vi.fn<TraceLegacyRead["findById"]>(
    reads.findById ?? (async () => traceRow("trace-1")),
  );
  const getEvaluationsMultiple = vi.fn<TraceLegacyRead["getEvaluationsMultiple"]>(
    reads.getEvaluationsMultiple ?? (async () => ({})),
  );
  const getAllTracesForProject = vi.fn<TraceLegacyRead["getAllTracesForProject"]>(
    reads.getAllTracesForProject ?? (async () => tracePage([])),
  );
  const getTracesWithSpans = vi.fn<TraceLegacyRead["getTracesWithSpans"]>(
    reads.getTracesWithSpans ?? (async () => []),
  );
  const getByTraceId = vi.fn<TraceSummaryReader["getByTraceId"]>(
    reads.getByTraceId ?? (async () => summaryRow(false)),
  );

  const spanReads: ReadCall[] = [];
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      spanReads.push({ name, args });
      return [];
    };

  const read: Partial<TraceLegacyRead> = {
    findById: tryGetById,
    getEvaluationsMultiple,
    getAllTracesForProject,
    getTracesWithSpans,
  };

  const spans: Partial<TracesSpanReader> = {
    getSpansByTraceId: record("getSpansByTraceId"),
    getSpanSummaryByTraceId: record("getSpanSummaryByTraceId"),
  };

  const summary: TraceSummaryReader = { getByTraceId };

  const app = TraceApp.create({
    storedObjects: createApiFixture<StoredObjectApi>(),
    traces: {
      existence: { findExistingTraceIds: async ({ traceIds }) => [...traceIds] },
      read: read as TraceLegacyRead,
      spans: spans as TracesSpanReader,
      summary,
      list: {} as TracesListReader,
      sessionGroups: {} as TracesSessionGroupsReader,
      tree: {} as TraceTreeService,
      logRecords: { getLogsByTraceId: async () => [] },
      canonicalisation: {} as TraceCanonicalisationService,
      editOverlay: {} as TraceEditOverlayStore,
      changeTraceName: async () => undefined,
    },
    topics: {} as TopicApi,
    broadcast: {
      getTenantEmitter: () => {
        throw new Error("no read in this suite subscribes");
      },
      cleanupTenantEmitter: () => undefined,
    },
    evaluations: {} as EvaluationApi,
    codingAgents: {} as CodingAgentApi,
    share: {} as ShareApi,
    projects: {
      getOrganizationId: async (projectId: string) => `organization-of-${projectId}`,
    } as ProjectApi,
    requestBounds: createTraceTestRequestBounds(),
    exportBounds: null,
  });

  return {
    app,
    spanReads,
    tryGetById,
    getEvaluationsMultiple,
    getAllTracesForProject,
    getTracesWithSpans,
    getByTraceId,
  };
}

describe("TraceApp", () => {
  it("declares Presence as the export progress peer its composed download service uses", () => {
    expect(TraceApp.dependencies.presence).toBe(PresenceApi);
  });

  describe("findTrace()", () => {
    describe("given a read that shows the content it fetches", () => {
      it("resolves the trace in full rather than serving the stored preview", async () => {
        const { app, tryGetById } = harness();

        await app.findTrace({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
        });

        expect(tryGetById).toHaveBeenCalledWith("project-1", "trace-1", PROTECTIONS, {
          full: true,
        });
      });
    });

    describe("when the caller says nothing about reviewer corrections", () => {
      it("leaves the overlay opt-in rather than asking for it or refusing it", async () => {
        const { app, tryGetById } = harness();

        await app.findTrace({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
        });

        expect(tryGetById.mock.calls[0]?.[3]).not.toHaveProperty("withEditOverlay");
      });
    });

    describe("when the caller asks for the corrected trace", () => {
      it("forwards the overlay flag alongside full resolution", async () => {
        const { app, tryGetById } = harness();

        await app.findTrace({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
          withEditOverlay: true,
        });

        expect(tryGetById).toHaveBeenCalledWith("project-1", "trace-1", PROTECTIONS, {
          full: true,
          withEditOverlay: true,
        });
      });
    });

    describe("given a project that holds no such trace", () => {
      // The application answers "nothing"; turning that into a 404 is the
      // door's business, and both doors depend on getting `undefined` rather
      // than a throw.
      it("answers undefined rather than failing", async () => {
        const { app } = harness({ findById: async () => undefined });

        await expect(
          app.findTrace({
            projectId: "project-1",
            traceId: "missing",
            protections: PROTECTIONS,
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("readEvaluations()", () => {
    it("asks for exactly the trace ids it was given", async () => {
      const verdicts: Record<string, Evaluation[]> = { "trace-1": [] };
      const { app, getEvaluationsMultiple } = harness({
        getEvaluationsMultiple: async () => verdicts,
      });

      const result = await app.readEvaluations({
        projectId: "project-1",
        traceIds: ["trace-1"],
        protections: PROTECTIONS,
      });

      expect(getEvaluationsMultiple).toHaveBeenCalledWith("project-1", ["trace-1"], PROTECTIONS);
      expect(result).toBe(verdicts);
    });
  });

  describe("readSpans()", () => {
    describe("given a caller that knows when the trace occurred", () => {
      it("passes the hint on the span read", async () => {
        const { app, spanReads } = harness();

        await app.readSpans({
          projectId: "project-1",
          traceId: "trace-1",
          occurredAtMs: 1_700_000_000_000,
        });

        expect(spanReads[0]?.args[0]).toMatchObject({ occurredAtMs: 1_700_000_000_000 });
      });
    });

    describe("given a caller that does not know when the trace occurred", () => {
      // Present-and-undefined is the bug: it turns a bounded read into a scan
      // of every weekly partition, cold storage included.
      it("omits the key from the span read rather than sending it empty", async () => {
        const { app, spanReads } = harness();

        await app.readSpans({ projectId: "project-1", traceId: "trace-1" });

        expect(spanReads[0]?.args[0]).not.toHaveProperty("occurredAtMs");
      });

      it("omits the key from the span-summary read too", async () => {
        const { app, spanReads } = harness();

        await app.readSpanSummaries({ projectId: "project-1", traceId: "trace-1" });

        expect(spanReads[0]?.args[0]).not.toHaveProperty("occurredAtMs");
      });
    });
  });

  describe("isTraceWindowRedacted()", () => {
    describe("given a plan with no visibility window", () => {
      it("answers not redacted without reading the summary at all", async () => {
        const { app, getByTraceId } = harness();

        await expect(
          app.isTraceWindowRedacted({
            projectId: "project-1",
            traceId: "trace-1",
            visibilityCutoffMs: null,
          }),
        ).resolves.toBe(false);
        expect(getByTraceId).not.toHaveBeenCalled();
      });
    });

    describe("given a window the trace falls outside", () => {
      it("answers redacted, on the same summary read the drawer header makes", async () => {
        const { app, getByTraceId } = harness({
          getByTraceId: async () => summaryRow(true),
        });

        await expect(
          app.isTraceWindowRedacted({
            projectId: "project-1",
            traceId: "trace-1",
            visibilityCutoffMs: 1_000,
          }),
        ).resolves.toBe(true);
        expect(getByTraceId).toHaveBeenCalledWith(
          "project-1",
          "trace-1",
          expect.objectContaining({ visibilityCutoffMs: 1_000, full: false }),
        );
      });
    });

    describe("given a window the trace falls inside", () => {
      it("answers not redacted", async () => {
        const { app } = harness({ getByTraceId: async () => summaryRow(false) });

        await expect(
          app.isTraceWindowRedacted({
            projectId: "project-1",
            traceId: "trace-1",
            visibilityCutoffMs: 1_000,
          }),
        ).resolves.toBe(false);
      });
    });

    describe("given a summary that cannot be read", () => {
      // A correction quotes captured content, so a trace whose age we cannot
      // establish must not open it. The closed answer is the correct one.
      it("withholds the content rather than assuming the trace is inside the window", async () => {
        const { app } = harness({
          getByTraceId: async () => {
            throw new Error("summary store unreachable");
          },
        });

        await expect(
          app.isTraceWindowRedacted({
            projectId: "project-1",
            traceId: "trace-1",
            visibilityCutoffMs: 1_000,
          }),
        ).resolves.toBe(true);
      });
    });
  });

  describe("readSampleTraces()", () => {
    const query = { projectId: "project-1", startDate: 1_000, endDate: 2_000 };

    describe("given a page of matching traces", () => {
      it("lists for ids on the preview, then reads those traces in full", async () => {
        const page = tracePage([traceRow("trace-1"), traceRow("trace-2")]);
        const { app, getAllTracesForProject, getTracesWithSpans } = harness({
          getAllTracesForProject: async () => page,
        });

        await app.readSampleTraces({ query, protections: PROTECTIONS, pageSize: 10 });

        expect(getAllTracesForProject.mock.calls[0]?.[0]).toMatchObject({
          groupBy: "none",
          pageSize: 10,
        });
        expect(getAllTracesForProject.mock.calls[0]?.[2]).toBeUndefined();
        expect(getTracesWithSpans).toHaveBeenCalledWith(
          "project-1",
          ["trace-1", "trace-2"],
          PROTECTIONS,
          { from: 1_000, to: 2_000 },
          { full: true },
        );
      });
    });

    describe("given a window that matched nothing", () => {
      it("never issues the second read", async () => {
        const { app, getTracesWithSpans } = harness();

        await expect(
          app.readSampleTraces({ query, protections: PROTECTIONS, pageSize: 10 }),
        ).resolves.toEqual([]);
        expect(getTracesWithSpans).not.toHaveBeenCalled();
      });
    });
  });
});
