/**
 * #4991 ("2 of 2" of #4888) — AC1 call-site wiring for ExportService.
 *
 * A trace export consumes content: a truncated value is data loss in the CSV/
 * JSONL. Proves (a) ExportService.create() constructs TraceService WITH
 * blob-resolution deps, and (b) BOTH export modes opt resolveBlobs into the
 * getAllTracesForProject options — full mode because it emits span IO, summary
 * mode because it still emits trace-level input/output.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/traces/protections";
import type { TraceService } from "~/server/traces/trace.service";
import type {
  GetAllTracesForProjectOptions,
  TracesForProjectResult,
} from "~/server/traces/types";
import { ExportService } from "../export.service";
import type { ExportRequest } from "../types";

const { mockTraceServiceCreate, mockBuildDeps, BLOB_DEPS } = vi.hoisted(() => {
  const BLOB_DEPS = {
    blobStore: { tag: "blobStore" },
    ioExtractionService: { tag: "ioExtractionService" },
  };
  return {
    mockTraceServiceCreate: vi.fn(),
    mockBuildDeps: vi.fn(() => BLOB_DEPS),
    BLOB_DEPS,
  };
});

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: { create: mockTraceServiceCreate },
}));

vi.mock("~/server/traces/trace-blob-resolution.deps", () => ({
  buildTraceBlobResolutionDeps: mockBuildDeps,
}));

const protections: Protections = {
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

function buildExportRequest(overrides?: Partial<ExportRequest>): ExportRequest {
  return {
    projectId: "proj-1",
    mode: "summary",
    format: "csv",
    filters: {},
    startDate: 1_700_000_000_000,
    endDate: 1_700_000_100_000,
    ...overrides,
  };
}

/**
 * A TraceService stub whose getAllTracesForProject records the options it was
 * called with, then returns a single-batch result so the export loop terminates.
 */
function buildOptionsCapturingTraceService(): {
  traceService: TraceService;
  optionsSeen: GetAllTracesForProjectOptions[];
} {
  const optionsSeen: GetAllTracesForProjectOptions[] = [];
  const traceService = {
    getAllTracesForProject: vi.fn(
      async (
        _input: unknown,
        _protections: unknown,
        options: GetAllTracesForProjectOptions,
      ): Promise<TracesForProjectResult> => {
        optionsSeen.push(options);
        // A complete-enough Trace so the real CSV/JSON serializers run.
        const trace = {
          trace_id: "t1",
          project_id: "proj-1",
          metadata: {},
          timestamps: {
            started_at: 1_700_000_000_000,
            inserted_at: 1_700_000_001_000,
            updated_at: 1_700_000_002_000,
          },
          input: { value: "hello" },
          output: { value: "world" },
          spans: [],
          evaluations: [],
        };
        return {
          groups: [[trace as never]],
          totalHits: 1,
          traceChecks: {},
          scrollId: undefined,
        } as TracesForProjectResult;
      },
    ),
  } as unknown as TraceService;
  return { traceService, optionsSeen };
}

async function drainExport(service: ExportService, request: ExportRequest) {
  for await (const _chunk of service.exportTraces({ request, protections })) {
    // consume the generator
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBuildDeps.mockReturnValue(BLOB_DEPS);
});

describe("ExportService — #4991 AC1 full export resolution", () => {
  describe("when ExportService.create() builds the service", () => {
    it("constructs TraceService with blob-resolution deps", async () => {
      mockTraceServiceCreate.mockReturnValue({} as TraceService);

      await ExportService.create({} as never);

      expect(mockTraceServiceCreate).toHaveBeenCalledWith(
        expect.anything(),
        BLOB_DEPS,
      );
    });
  });

  describe("given a FULL export (mode: full, includes spans)", () => {
    describe("when exportTraces streams a batch", () => {
      it("opts resolveBlobs into the getAllTracesForProject options", async () => {
        const { traceService, optionsSeen } =
          buildOptionsCapturingTraceService();
        const service = new ExportService({ traceService });

        await drainExport(service, buildExportRequest({ mode: "full" }));

        expect(optionsSeen.length).toBeGreaterThan(0);
        expect(optionsSeen.every((o) => o.resolveBlobs === true)).toBe(true);
        expect(optionsSeen.every((o) => o.includeSpans === true)).toBe(true);
      });
    });
  });

  // A SUMMARY export reads NO span content — but it is still a content-consuming
  // read: buildSummaryRow emits trace-level `trace.input.value` / `trace.output
  // .value` (serializers/csv-serializer.ts:91-92), and the summary JSON
  // serializer does the same. Gating resolution on includeSpans therefore
  // silently shipped the truncated 64 KB preview for any offloaded (>64 KB)
  // trace, with no error and no indication data was cut — the exact data-loss
  // bug this PR exists to fix, just on the other export mode.
  describe("given a SUMMARY export (reads trace-level input/output)", () => {
    describe("when exportTraces streams a batch", () => {
      it("opts resolveBlobs in so an offloaded trace is not truncated to its preview", async () => {
        const { traceService, optionsSeen } =
          buildOptionsCapturingTraceService();
        const service = new ExportService({ traceService });

        await drainExport(service, buildExportRequest({ mode: "summary" }));

        expect(optionsSeen.length).toBeGreaterThan(0);
        expect(optionsSeen.every((o) => o.resolveBlobs === true)).toBe(true);
      });

      it("reads no span content (includeSpans stays false)", async () => {
        const { traceService, optionsSeen } =
          buildOptionsCapturingTraceService();
        const service = new ExportService({ traceService });

        await drainExport(service, buildExportRequest({ mode: "summary" }));

        expect(optionsSeen.every((o) => o.includeSpans === false)).toBe(true);
      });
    });
  });

  // Grounds WHY the assertion above must hold: prove the summary payload really
  // does carry the trace-level IO value. If a future change stopped emitting
  // input/output in summary rows, resolving blobs there would become dead cost
  // and this test would tell us so.
  describe("given a SUMMARY csv export of a trace with trace-level IO", () => {
    describe("when the export is drained", () => {
      it("emits the trace input/output value into the payload", async () => {
        const { traceService } = buildOptionsCapturingTraceService();
        const service = new ExportService({ traceService });

        let payload = "";
        for await (const { chunk } of service.exportTraces({
          request: buildExportRequest({ mode: "summary", format: "csv" }),
          protections,
        })) {
          payload += chunk;
        }

        // The stub trace carries input "hello" / output "world".
        expect(payload).toContain("hello");
        expect(payload).toContain("world");
      });
    });
  });
});
