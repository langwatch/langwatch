import { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
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

import { aggregateProof, ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceSummaryService } from "../../features/read/services/trace-summary-read.service.ts";
import type { TraceSpanCostSuggestion } from "../../features/span/services/span-cost-suggestion.service.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { MemoryTraceSummaryRepository } from "../../repositories/memory/memory.trace-summary.repository.ts";
import type { TraceLegacyRead } from "../../services/trace-viewer.service.ts";
import type { TraceService as TraceTreeService } from "../../services/trace.service.ts";
import {
  TraceModule,
  type TraceEditOverlayStore,
  type TraceSummaryReader,
  type TracesListReader,
  type TracesSessionGroupsReader,
  type TracesSpanReader,
} from "../trace.app.ts";
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
    summary: TraceSummaryReader;
    evaluationRuns: MemoryTraceEvaluationRunsRepository;
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

  const summary: TraceSummaryReader = reads.summary ?? { getByTraceId };

  const app = TraceModule.fromDependencies({
    storedObjects: createApiFixture<StoredObjectApi>(),
    spanCostSuggestions: createApiFixture<TraceSpanCostSuggestion>(),
    traces: {
      existence: {
        findExistingTraceIds: async ({ traceIds }) => [...traceIds],
        countUsage: async () => ({ traces: 0, spans: 0 }),
        findTraceCosts: async () => [],
      },
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
    broadcast: {
      getTenantEmitter: () => {
        throw new Error("no read in this suite subscribes");
      },
      cleanupTenantEmitter: () => undefined,
    },
    evaluationRuns: reads.evaluationRuns ?? MemoryTraceEvaluationRunsRepository.create(),
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

describe("TraceModule", () => {
  it("declares Presence as the export progress peer its composed download service uses", () => {
    expect(TraceModule.dependencies.presence).toBe(PresenceApi);
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

        expect(tryGetById).toHaveBeenCalledWith({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
          opts: {
            full: true,
          },
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

        expect(tryGetById.mock.calls[0]?.[0].opts).not.toHaveProperty("withEditOverlay");
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

        expect(tryGetById).toHaveBeenCalledWith({
          projectId: "project-1",
          traceId: "trace-1",
          protections: PROTECTIONS,
          opts: {
            full: true,
            withEditOverlay: true,
          },
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

  describe("when an evaluation read carries the route's proof (ADR-177 block F)", () => {
    const AGGREGATE = "project-aggregate";
    const ENGINEER = "project-engineer";
    const SELLER = "project-seller";
    const aggregate = () =>
      aggregateProof({
        projectId: AGGREGATE,
        members: [
          { projectId: ENGINEER, from: 0 },
          { projectId: SELLER, from: 0 },
        ],
      });
    const run = (tenantId: string) => ({
      tenantId,
      evaluationId: `evaluation-${tenantId}`,
      evaluatorId: "evaluator-1",
      evaluatorType: "langevals/exact_match",
      evaluatorName: null,
      traceId: "trace-1",
      isGuardrail: false,
      status: "processed" as const,
      score: 1,
      passed: true,
      label: null,
      details: "quotes the captured input",
      inputs: { input: "captured" },
      error: null,
      errorDetails: null,
      createdAt: 1_000,
      updatedAt: 1_000,
      LastEventOccurredAt: 1_000,
      archivedAt: null,
      scheduledAt: null,
      startedAt: null,
      completedAt: null,
      costId: null,
    });
    const VISIBLE = { canSeeCapturedInput: true, canSeeCapturedOutput: true };

    async function memberHarness({ holders }: { holders: string[] }) {
      const repository = MemoryTraceSummaryRepository.create();
      for (const tenantId of holders) {
        await repository.upsert({ ...summaryRow(false), traceId: "trace-1" }, tenantId);
      }
      const built = harness({
        summary: TraceSummaryService.create({ repository }),
        evaluationRuns: MemoryTraceEvaluationRunsRepository.create({
          runs: [run(ENGINEER), run(SELLER), run("project-1")],
        }),
      });
      const protect = vi.spyOn(built.app, "resolveViewerProtections").mockResolvedValue(VISIBLE);
      return { ...built, protect };
    }

    describe("given a plain project's proof", () => {
      it("reads its one project's runs and verdicts, never an empty answer", async () => {
        const { app, getEvaluationsMultiple } = await memberHarness({ holders: [] });
        const proof = { projectId: "project-1", traceId: "trace-1", viewerUserId: "user-1" };

        const runs = await app.readEvaluationRuns({ ...proof, authorization: ownProof(proof) });
        const verdicts = await app.readEvaluations({ ...proof, authorization: ownProof(proof) });

        expect(runs.map((r) => r.evaluationId)).toEqual(["evaluation-project-1"]);
        expect(verdicts["trace-1"]?.map((e) => e.evaluation_id)).toEqual(["evaluation-project-1"]);
        expect(getEvaluationsMultiple).not.toHaveBeenCalled();
      });
    });

    describe("given an aggregate whose request names the member", () => {
      it("reads that member's runs, with protections through the narrowed proof", async () => {
        const { app, protect } = await memberHarness({ holders: [SELLER] });

        const runs = await app.readEvaluationRuns({
          projectId: AGGREGATE,
          traceId: "trace-1",
          tenantId: SELLER,
          authorization: aggregate(),
          viewerUserId: "user-1",
        });

        expect(runs.map((r) => r.evaluationId)).toEqual([`evaluation-${SELLER}`]);
        expect(protect.mock.calls[0]?.[0].authorization?.narrowedTo).toBe(SELLER);
      });

      it("reads the drawer's verdicts through the narrowed proof, never another member's", async () => {
        const { app, protect } = await memberHarness({ holders: [SELLER] });
        protect.mockResolvedValue({ canSeeCapturedInput: false, canSeeCapturedOutput: true });

        const verdicts = await app.readEvaluations({
          projectId: AGGREGATE,
          traceId: "trace-1",
          tenantId: SELLER,
          authorization: aggregate(),
          viewerUserId: "user-1",
        });

        expect(verdicts["trace-1"]?.map((e) => e.evaluation_id)).toEqual([`evaluation-${SELLER}`]);
        expect(verdicts["trace-1"]?.[0]).toMatchObject({
          score: 1,
          details: null,
          inputs: undefined,
        });
      });
    });

    describe("when a detail read asks for the trace's member proof", () => {
      it("narrows an aggregate to the member that holds the trace", async () => {
        const { app } = await memberHarness({ holders: [ENGINEER] });

        const proof = await app.authorizationForTrace({
          authorization: aggregate(),
          traceId: "trace-1",
        });

        expect(proof.narrowedTo).toBe(ENGINEER);
      });

      it("refuses a named member the proof cannot read as trace not found", async () => {
        const { app } = await memberHarness({ holders: [ENGINEER] });

        await expect(
          app.authorizationForTrace({
            authorization: aggregate(),
            traceId: "trace-1",
            tenantId: "project-outsider",
          }),
        ).rejects.toMatchObject({ code: "trace_not_found" });
      });
    });

    describe("given an aggregate no member of which holds the trace", () => {
      it("answers empty rather than reading across every member", async () => {
        const { app, getEvaluationsMultiple } = await memberHarness({ holders: [] });
        const input = {
          projectId: AGGREGATE,
          traceId: "trace-1",
          authorization: aggregate(),
          viewerUserId: "user-1",
        };

        await expect(app.readEvaluationRuns(input)).resolves.toEqual([]);
        await expect(app.readEvaluations(input)).resolves.toEqual({});
        expect(getEvaluationsMultiple).not.toHaveBeenCalled();
      });
    });

    describe("given a summary reader that cannot narrow", () => {
      it("refuses the member read loudly", async () => {
        const { app } = harness();

        await expect(
          app.readEvaluationRuns({
            projectId: AGGREGATE,
            traceId: "trace-1",
            authorization: aggregate(),
            viewerUserId: "user-1",
          }),
        ).rejects.toThrow("Trace member narrowing is unavailable");
      });
    });

    describe("given protections that hide captured content", () => {
      it("keeps the verdict and drops the quoted content", async () => {
        const { app, protect } = await memberHarness({ holders: [SELLER] });
        protect.mockResolvedValue({ canSeeCapturedInput: false, canSeeCapturedOutput: true });

        const [gated] = await app.readEvaluationRuns({
          projectId: AGGREGATE,
          traceId: "trace-1",
          authorization: aggregate(),
          viewerUserId: "user-1",
        });

        expect(gated).toMatchObject({ score: 1, passed: true, details: null, inputs: null });
      });
    });
  });

  describe("readSpans()", () => {
    describe("given a caller that knows when the trace occurred", () => {
      it("passes the hint on the span read", async () => {
        const { app, spanReads } = harness();

        await app.readSpans({
          authorization: ownProof({ projectId: "project-1" }),
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

        await app.readSpans({
          authorization: ownProof({ projectId: "project-1" }),
          traceId: "trace-1",
        });

        expect(spanReads[0]?.args[0]).not.toHaveProperty("occurredAtMs");
      });

      it("omits the key from the span-summary read too", async () => {
        const { app, spanReads } = harness();

        await app.readSpanSummaries({
          authorization: ownProof({ projectId: "project-1" }),
          traceId: "trace-1",
        });

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
            authorization: ownProof({ projectId: "project-1" }),
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
            authorization: ownProof({ projectId: "project-1" }),
            traceId: "trace-1",
            visibilityCutoffMs: 1_000,
          }),
        ).resolves.toBe(true);
        expect(getByTraceId).toHaveBeenCalledWith(
          expect.objectContaining({ traceId: "trace-1", visibilityCutoffMs: 1_000, full: false }),
        );
      });
    });

    describe("given a window the trace falls inside", () => {
      it("answers not redacted", async () => {
        const { app } = harness({ getByTraceId: async () => summaryRow(false) });

        await expect(
          app.isTraceWindowRedacted({
            authorization: ownProof({ projectId: "project-1" }),
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
            authorization: ownProof({ projectId: "project-1" }),
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
        expect(getTracesWithSpans).toHaveBeenCalledWith({
          projectId: "project-1",
          traceIds: ["trace-1", "trace-2"],
          protections: PROTECTIONS,
          occurredAt: { from: 1_000, to: 2_000 },
          opts: { full: true },
        });
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
