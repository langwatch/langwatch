/**
 * @vitest-environment node
 *
 * The `traces.*` tRPC surface: that each read reaches the process-owned trace
 * reader, and that the ones which CONSUME trace content ask for the full value
 * while the ones that merely list it stay on the stored preview (#4991).
 *
 * Ported from the two suites that drove the application-owned router
 * (`traces.getAllForProject.unit.test.ts` and
 * `traces.4991-full-resolution.unit.test.ts`) when the surface moved into this
 * package. The assertions are unchanged; only the harness is, because the
 * policy chain, the viewer's protections and the filter schemas are now handed
 * in rather than imported.
 */
import type { TraceLegacyReadPort } from "../src/ports/trace-legacy-read.port";
import { TracesTrpcApi } from "../src/transport/api-trpc/traces.api";
import { TraceApp, type TraceAppDependencies } from "../src/app/trace.app";
import { initTRPC } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const filterInputSchema = z.object({
  projectId: z.string(),
  startDate: z.number(),
  endDate: z.number(),
  query: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).default({}),
});

const listInputSchema = filterInputSchema.extend({
  pageSize: z.number().optional(),
  groupBy: z.string().optional(),
  sortBy: z.string().optional(),
  sortDirection: z.string().optional(),
  scrollId: z.string().nullable().optional(),
  updatedAt: z.number().optional(),
});

const mockGetAllTracesForProject = vi.fn();
const mockGetTracesWithSpans = vi.fn();
const mockGetTracesByThreadId = vi.fn();
const mockGetTracesWithSpansByThreadIds = vi.fn();

const fakeRead = {
  getAllTracesForProject: mockGetAllTracesForProject,
  getTracesWithSpans: mockGetTracesWithSpans,
  getTracesByThreadId: mockGetTracesByThreadId,
  getTracesWithSpansByThreadIds: mockGetTracesWithSpansByThreadIds,
} as unknown as TraceLegacyReadPort;

type TestContext = { app: { traces: TraceApp } };

/**
 * The App holds every service the trace feature's five doors reach; the
 * `traces.*` surface reaches three of them. The bag is narrowed rather than
 * stubbed whole because a complete one would mean hand-writing four service
 * contracts nothing here calls — and a reach for any of them throws on the
 * missing property, which is the loud failure we want.
 */
const app = TraceApp.create({
  traces: { read: fakeRead },
  topics: { getAll: async () => [] },
  broadcast: {
    getTenantEmitter: () => {
      throw new Error("not used by these tests");
    },
    cleanupTenantEmitter: () => undefined,
  },
} as unknown as TraceAppDependencies);

function harness({
  policy = <TProcedure>(procedure: TProcedure): TProcedure => procedure,
}: {
  policy?: <TProcedure>(procedure: TProcedure) => TProcedure;
} = {}) {
  const trpc = initTRPC.context<TestContext>().create();

  const router = TracesTrpcApi.create(
    trpc,
    { protected: trpc.procedure, policy: () => policy },
    {
      filterInputSchema,
      listInputSchema,
      evaluatorTypeSchema: z.string(),
      preconditionSchema: z.unknown(),
      getViewerProtections: async () => ({
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: true,
      }),
      formatSpansDigest: async () => "digest",
      checkEvaluatorRequiredFields: () => true,
      buildPreconditionTraceData: () => ({}),
      evaluatePreconditions: () => true,
    },
  );

  return {
    router,
    caller: router.createCaller({ app: { traces: app } }),
  };
}

const baseFilters = {
  projectId: "project_123",
  startDate: Date.now() - 86_400_000,
  endDate: Date.now(),
  filters: {},
};

let caller: ReturnType<typeof harness>["caller"];

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAllTracesForProject.mockResolvedValue({
    groups: [[{ trace_id: "t1" }]],
    totalHits: 1,
    traceChecks: {},
  });
  mockGetTracesWithSpans.mockResolvedValue([]);
  mockGetTracesByThreadId.mockResolvedValue([]);
  mockGetTracesWithSpansByThreadIds.mockResolvedValue([]);
  caller = harness().caller;
});

describe("TracesTrpcApi", () => {
  describe("given a process policy that reads the validated input", () => {
    /**
     * tRPC appends the input parser as a middleware at the point `.input()`
     * is called, so anything installed before it runs with `input ===
     * undefined`. The process's real policy resolves the authorized scope id
     * FROM the input, which is why this feature applies the decorator after
     * its own parser. Composed the other way round the authorization check,
     * the scope-lineage guard and the audit row would all see nothing, and
     * nothing would report an error.
     */
    it("hands the policy a procedure whose input is already parsed", async () => {
      const seen: unknown[] = [];
      const observed = harness({
        policy: <TProcedure>(procedure: TProcedure): TProcedure =>
          (
            procedure as unknown as {
              use(middleware: unknown): unknown;
            }
          ).use(({ input, next }: { input: unknown; next: () => unknown }) => {
            seen.push(input);
            return next();
          }) as TProcedure,
      });

      await observed.caller.getAllForProject(baseFilters);

      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ projectId: "project_123" });
    });
  });

  describe("when scrollId is provided in the input", () => {
    it("forwards scrollId to the trace service options parameter", async () => {
      const scrollId = "base64encodedcursordata";

      await caller.getAllForProject({ ...baseFilters, pageSize: 10, scrollId });

      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.objectContaining({ scrollId }),
        expect.any(Object),
        { scrollId },
      );
    });
  });

  describe("when scrollId is not provided", () => {
    it("forwards undefined scrollId in options", async () => {
      await caller.getAllForProject({ ...baseFilters, pageSize: 10 });

      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        { scrollId: undefined },
      );
    });
  });

  describe("when getTracesByThreadId is called", () => {
    it("requests full resolution (full:true)", async () => {
      await caller.getTracesByThreadId({
        projectId: "project_123",
        threadId: "thread-1",
      });
      expect(mockGetTracesByThreadId).toHaveBeenCalledWith(
        "project_123",
        "thread-1",
        expect.any(Object),
        { full: true },
      );
    });
  });

  describe("when getTracesWithSpansByThreadIds is called", () => {
    it("requests full resolution and leaves corrections opt-in", async () => {
      await caller.getTracesWithSpansByThreadIds({
        projectId: "project_123",
        threadIds: ["thread-1"],
      });
      // Trace corrections are opt-in per caller, so a thread read that does
      // not ask for them gets what was captured.
      expect(mockGetTracesWithSpansByThreadIds).toHaveBeenCalledWith(
        "project_123",
        ["thread-1"],
        expect.any(Object),
        { full: true, withEditOverlay: false },
      );
    });
  });

  describe("when getSampleTracesDataset is called", () => {
    it("resolves spans full", async () => {
      await caller.getSampleTracesDataset(baseFilters);
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t1"],
        expect.any(Object),
        expect.any(Object),
        { full: true },
      );
    });
  });

  describe("when getSampleTraces is called", () => {
    it("resolves spans full", async () => {
      await caller.getSampleTraces({
        ...baseFilters,
        evaluatorType: "custom/foo",
        preconditions: [],
        expectedResults: 10,
      });
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t1"],
        expect.any(Object),
        expect.any(Object),
        { full: true },
      );
    });
  });

  describe("when getAllForDownload is called with includeSpans", () => {
    it("opts resolveBlobs into the options", async () => {
      await caller.getAllForDownload({ ...baseFilters, includeSpans: true });
      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ downloadMode: true, resolveBlobs: true }),
      );
    });
  });

  // A download returns trace-level input/output whether or not spans are
  // included, so gating resolveBlobs on includeSpans truncated any offloaded
  // trace in a spans-less download — the same bug fixed in ExportService for
  // summary-mode exports. Falsifiable: restore `resolveBlobs: input.includeSpans`
  // and this fails while the includeSpans:true case above still passes.
  describe("when getAllForDownload is called WITHOUT includeSpans", () => {
    it("still opts resolveBlobs in, so the download is not truncated", async () => {
      await caller.getAllForDownload({ ...baseFilters, includeSpans: false });
      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          downloadMode: true,
          includeSpans: false,
          resolveBlobs: true,
        }),
      );
    });
  });

  describe("when getAllForProject (list grid) is called", () => {
    it("reads once without enabling blob resolution", async () => {
      await caller.getAllForProject(baseFilters);
      expect(mockGetAllTracesForProject).toHaveBeenCalledTimes(1);
      expect(mockGetAllTracesForProject).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Object),
        expect.not.objectContaining({ resolveBlobs: true }),
      );
    });
  });

  describe("when getFormattedSpansDigest is called", () => {
    it("stays on previews and never requests full resolution", async () => {
      await caller.getFormattedSpansDigest({
        projectId: "project_123",
        traceIds: ["t1"],
      });
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t1"],
        expect.any(Object),
        undefined,
        { withEditOverlay: false },
      );
    });

    it("stays on previews when it is asked for the corrected trace", async () => {
      await caller.getFormattedSpansDigest({
        projectId: "project_123",
        traceIds: ["t1"],
        withEditOverlay: true,
      });
      // Applying a correction needs neither the blob-resolution deps nor full
      // resolution, so asking for one must not drag a whole page of offloaded
      // values in behind it.
      expect(mockGetTracesWithSpans).toHaveBeenCalledWith(
        "project_123",
        ["t1"],
        expect.any(Object),
        undefined,
        { withEditOverlay: true },
      );
    });
  });
});
