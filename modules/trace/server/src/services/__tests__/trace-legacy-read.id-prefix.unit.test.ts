/**
 * @vitest-environment node
 * Spec: modules/trace/specs/partial-trace-id-resolution.feature — an
 * exact id skips the scan, a unique prefix resolves, an ambiguous one refuses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { Protections, Trace, TraceCanonicalisationService } from "@langwatch/trace-contract";

const { mockGetTracesWithSpans, mockResolveTraceIdByPrefix } = vi.hoisted(() => ({
  mockGetTracesWithSpans: vi.fn(),
  mockResolveTraceIdByPrefix: vi.fn(),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const fakeSpan = { setAttribute: () => {}, setAttributes: () => {} };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

import { AmbiguousTraceIdPrefixError, TraceService } from "../trace-legacy-read.service.ts";
import type { TraceLegacyReadRepository } from "../../repositories/trace-legacy-read.repository.ts";
import type { TraceEditOverlayService } from "../trace-edit-overlay.service.ts";

const PROJECT_ID = "project_test";
const FULL_TRACE_ID = "63dc535cea6335c506bc81ef3543a07d";

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

function refusingEvaluations(): EvaluationApi {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("this test reads no evaluation behind a trace");
      },
    },
  ) as EvaluationApi;
}

function trace(traceId: string): Trace {
  return {
    trace_id: traceId,
    project_id: PROJECT_ID,
    metadata: {},
    timestamps: {
      started_at: 1_700_000_000_000,
      inserted_at: 1_700_000_000_000,
      updated_at: 1_700_000_001_000,
    },
    spans: [],
  } as unknown as Trace;
}

function makeService(): TraceService {
  return TraceService.create({
    traceCanonicalisation: {} as TraceCanonicalisationService,
    traceRead: {
      getTracesWithSpans: mockGetTracesWithSpans,
      getTracesWithSpansByThreadIds: vi.fn(),
      resolveTraceIdByPrefix: mockResolveTraceIdByPrefix,
    } as unknown as TraceLegacyReadRepository,
    editOverlay: { getPatchesByTraceIds: vi.fn() } as unknown as TraceEditOverlayService,
    evaluationService: refusingEvaluations(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTracesWithSpans.mockResolvedValue([]);
  mockResolveTraceIdByPrefix.mockResolvedValue([]);
});

describe("given a project with traces stored in ClickHouse", () => {
  describe("when the caller passes a full trace id", () => {
    /** @scenario Full trace ID resolves exactly */
    it("returns the trace without ever scanning for a prefix", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace(FULL_TRACE_ID)]);

      const result = await makeService().tryGetById(PROJECT_ID, FULL_TRACE_ID, protections);

      expect(result?.trace_id).toBe(FULL_TRACE_ID);
      expect(mockResolveTraceIdByPrefix).not.toHaveBeenCalled();
    });
  });

  describe("when the caller passes a prefix that matches one trace", () => {
    /** @scenario Unique prefix resolves to the full trace */
    it("resolves it to the full trace", async () => {
      mockGetTracesWithSpans
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([trace(FULL_TRACE_ID)]);
      mockResolveTraceIdByPrefix.mockResolvedValue([FULL_TRACE_ID]);

      const result = await makeService().tryGetById(
        PROJECT_ID,
        "63dc535cea6335c506bc",
        protections,
      );

      expect(result?.trace_id).toBe(FULL_TRACE_ID);
      // Scoped to the caller's project, and to a bounded window, so the scan
      // cannot walk every partition including cold storage.
      const scan = mockResolveTraceIdByPrefix.mock.calls[0]![0];
      expect(scan.projectId).toBe(PROJECT_ID);
      expect(scan.prefix).toBe("63dc535cea6335c506bc");
      expect(scan.occurredAt.from).toBeLessThan(scan.occurredAt.to);
    });
  });

  describe("when the prefix matches more than one trace", () => {
    /** @scenario Ambiguous prefix returns 409 with the matching IDs */
    it("refuses with the candidate ids rather than guessing one", async () => {
      const candidates = ["abc12345def456", "abc12345def999"];
      mockResolveTraceIdByPrefix.mockResolvedValue(candidates);

      const failure = await makeService()
        .tryGetById(PROJECT_ID, "abc12345", protections)
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(AmbiguousTraceIdPrefixError);
      expect((failure as AmbiguousTraceIdPrefixError).candidateTraceIds).toEqual(candidates);
      expect((failure as AmbiguousTraceIdPrefixError).message).toContain("ambiguous");
      for (const candidate of candidates) {
        expect((failure as AmbiguousTraceIdPrefixError).message).toContain(candidate);
      }
    });
  });

  describe("when nothing in the project starts with the prefix", () => {
    /** @scenario No match returns 404 */
    it("resolves to nothing so the transport answers not found", async () => {
      await expect(
        makeService().tryGetById(PROJECT_ID, "deadbeef", protections),
      ).resolves.toBeUndefined();
      expect(mockResolveTraceIdByPrefix).toHaveBeenCalled();
    });
  });

  describe("when the prefix belongs to another project", () => {
    /** @scenario Prefix match is scoped to the current project */
    it("scans only the caller's project", async () => {
      await makeService().tryGetById("project_b", "aaaa1111", protections);

      expect(mockResolveTraceIdByPrefix.mock.calls[0]![0].projectId).toBe("project_b");
    });
  });

  describe("when the input is shorter than the minimum prefix", () => {
    /** @scenario Too-short prefix falls through to 404 */
    it("never scans", async () => {
      await expect(
        makeService().tryGetById(PROJECT_ID, "ab", protections),
      ).resolves.toBeUndefined();
      expect(mockResolveTraceIdByPrefix).not.toHaveBeenCalled();
    });
  });

  describe("when the input is not hexadecimal", () => {
    /** @scenario Non-hex input skips prefix scan and returns 404 */
    it("never scans", async () => {
      await expect(
        makeService().tryGetById(PROJECT_ID, "not-a-hex-id-zzzz", protections),
      ).resolves.toBeUndefined();
      expect(mockResolveTraceIdByPrefix).not.toHaveBeenCalled();
    });
  });
});
