/**
 * @vitest-environment node
 *
 * The trace application's own rules — the ones a door would otherwise have to
 * know, and which several doors used to spell out for themselves.
 *
 * Three of them are pinned here for the first time:
 *
 *   - **Full resolution on a read that CONSUMES content (#4991).** The drawer
 *     read and the single-trace read both show the content they fetch, so they
 *     never serve the 64 KB stored preview. `traces-trpc-api.unit.test.ts`
 *     pins the thread, sample and download reads; this pins the by-id read
 *     that `/api/v1/traces/:traceId` has always relied on.
 *   - **The partition-pruning hint.** `occurredAtMs` is passed present or
 *     absent, never present and `undefined`. A key with no value turns a
 *     bounded read into a scan of every weekly partition, cold S3 storage
 *     included.
 *   - **The visibility-window verdict, fail-closed.** A correction quotes
 *     captured content, so a trace whose age cannot be established must not
 *     open it.
 *
 * @see specs/traces — #4991 full resolution
 */
import type {
  Evaluation,
  TraceCanonicalisationService,
  TraceService,
  TraceSummaryData,
  TraceWithGuardrail,
  TracesForProjectResult,
} from "@langwatch/trace-contract";
import type { EvaluationService } from "@langwatch/evaluation-contract";
import type { CodingAgentService } from "@langwatch/coding-agent-contract";
import { describe, expect, it, vi } from "vitest";

import type { TraceLegacyReadPort } from "../../ports/trace-legacy-read.port";
import {
  TraceApp,
  type TraceEditOverlayStore,
  type TraceProjectReader,
  type TraceShareReader,
  type TraceSummaryReader,
  type TracesTopicReader,
  type TracesV2ListReader,
  type TracesV2SessionGroupsReader,
  type TracesV2SpanReader,
} from "../trace.app";

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
 * The trace reads this suite drives, and nothing else. Every other collaborator
 * of the application is left off: a reach for one throws on the missing
 * property, which is the loud failure we want from a suite about what the
 * application decides rather than about what a store answers.
 */
function harness(
  reads: Partial<{
    getById: TraceLegacyReadPort["getById"];
    getEvaluationsMultiple: TraceLegacyReadPort["getEvaluationsMultiple"];
    getAllTracesForProject: TraceLegacyReadPort["getAllTracesForProject"];
    getTracesWithSpans: TraceLegacyReadPort["getTracesWithSpans"];
    getByTraceId: TraceSummaryReader["getByTraceId"];
  }> = {},
) {
  const getById = vi.fn<TraceLegacyReadPort["getById"]>(
    reads.getById ?? (async () => traceRow("trace-1")),
  );
  const getEvaluationsMultiple = vi.fn<TraceLegacyReadPort["getEvaluationsMultiple"]>(
    reads.getEvaluationsMultiple ?? (async () => ({})),
  );
  const getAllTracesForProject = vi.fn<TraceLegacyReadPort["getAllTracesForProject"]>(
    reads.getAllTracesForProject ?? (async () => tracePage([])),
  );
  const getTracesWithSpans = vi.fn<TraceLegacyReadPort["getTracesWithSpans"]>(
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

  const read: Partial<TraceLegacyReadPort> = {
    getById,
    getEvaluationsMultiple,
    getAllTracesForProject,
    getTracesWithSpans,
  };

  const spans: Partial<TracesV2SpanReader> = {
    getSpansByTraceId: record("getSpansByTraceId"),
    getSpanSummaryByTraceId: record("getSpanSummaryByTraceId"),
  };

  const summary: TraceSummaryReader = { getByTraceId };

  const app = TraceApp.create({
    traces: {
      read: read as TraceLegacyReadPort,
      spans: spans as TracesV2SpanReader,
      summary,
      list: {} as TracesV2ListReader,
      sessionGroups: {} as TracesV2SessionGroupsReader,
      tree: {} as TraceService,
      logRecords: { getLogsByTraceId: async () => [] },
      canonicalisation: {} as TraceCanonicalisationService,
      editOverlay: {} as TraceEditOverlayStore,
      changeTraceName: async () => undefined,
    },
    topics: {} as TracesTopicReader,
    broadcast: {
      getTenantEmitter: () => {
        throw new Error("no read in this suite subscribes");
      },
      cleanupTenantEmitter: () => undefined,
    },
    evaluations: {} as EvaluationService,
    codingAgents: {} as CodingAgentService,
    share: {} as TraceShareReader,
    projects: {} as TraceProjectReader,
  });

  return {
    app,
    spanReads,
    getById,
    getEvaluationsMultiple,
    getAllTracesForProject,
    getTracesWithSpans,
    getByTraceId,
  };
}

describe("TraceApp", () => {
  describe("readTrace", () => {
    describe("given a read that shows the content it fetches", () => {
      it("resolves the trace in full rather than serving the stored preview", async () => {
        const { app, getById } = harness();

        await app.readTrace({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
        });

        expect(getById).toHaveBeenCalledWith("project-1", "trace-1", PROTECTIONS, {
          full: true,
        });
      });
    });

    describe("when the caller says nothing about reviewer corrections", () => {
      it("leaves the overlay opt-in rather than asking for it or refusing it", async () => {
        const { app, getById } = harness();

        await app.readTrace({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
        });

        expect(getById.mock.calls[0]?.[3]).not.toHaveProperty("withEditOverlay");
      });
    });

    describe("when the caller asks for the corrected trace", () => {
      it("forwards the overlay flag alongside full resolution", async () => {
        const { app, getById } = harness();

        await app.readTrace({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
          withEditOverlay: true,
        });

        expect(getById).toHaveBeenCalledWith("project-1", "trace-1", PROTECTIONS, {
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
        const { app } = harness({ getById: async () => undefined });

        await expect(
          app.readTrace({
            projectId: "project-1",
            traceId: "missing",
            protections: PROTECTIONS,
          }),
        ).resolves.toBeUndefined();
      });
    });
  });

  describe("readEvaluations", () => {
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

  describe("the partition-pruning hint", () => {
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

  describe("isTraceWindowRedacted", () => {
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

  describe("readSampleTraces", () => {
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
