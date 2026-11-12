import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Protections, Trace, TraceCanonicalisationService } from "@langwatch/trace-contract";
/**
 * @vitest-environment node
 * Spec: modules/trace/specs/partial-trace-id-resolution.feature — an
 * exact id skips the scan, a unique prefix resolves, an ambiguous one refuses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockGetTracesWithSpans,
  mockResolveTraceIdByPrefix,
  mockFromStoredSpans,
  mockBySpanId,
  mockByScenarioRunId,
} = vi.hoisted(() => ({
  mockGetTracesWithSpans: vi.fn(),
  mockResolveTraceIdByPrefix: vi.fn(),
  mockFromStoredSpans: vi.fn(),
  mockBySpanId: vi.fn(),
  mockByScenarioRunId: vi.fn(),
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

import { ownProof } from "../../../../__tests__/support/authorization-proofs.fixture.ts";
import { MemoryTraceEditOverlayRepository } from "../../../../repositories/memory/memory.trace-edit-overlay.repository.ts";
import { TraceEditOverlayService } from "../../../edit-overlay/services/trace-edit-overlay.service.ts";
import type { TraceLegacyReadRepository } from "../../repositories/trace-legacy-read.repository.ts";
import type { LegacyTraceMappingService } from "../legacy-trace-mapping.service.ts";
import {
  AmbiguousTraceIdPrefixError,
  TraceLegacyReadService,
} from "../trace-legacy-read.service.ts";

const PROJECT_ID = "project_test";
const OWN_READ = ownProof({ projectId: PROJECT_ID });
const FULL_TRACE_ID = "63dc535cea6335c506bc81ef3543a07d";

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

/** Evaluation's shared runs, which this test does not read. */
function refusingEvaluations<T extends object>(): T {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("this test reads no evaluation behind a trace");
      },
    },
  ) as T;
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
  };
}

function makeService(): TraceLegacyReadService {
  return TraceLegacyReadService.create({
    traceCanonicalisation: {} as TraceCanonicalisationService,
    traceRead: createApiFixture<TraceLegacyReadRepository>(
      {
        resolveTraceIdByPrefix: mockResolveTraceIdByPrefix,
        resolveTraceIdsByScenarioRunId: mockByScenarioRunId,
        findTraceSummaries: vi.fn(),
        findCustomersAndLabels: vi.fn(),
        findDistinctFieldNames: vi.fn(),
        findTopicCounts: vi.fn(),
        findSpanForPromptStudio: vi.fn(),
      },
      "trace read store",
    ),
    mapping: createApiFixture<LegacyTraceMappingService>(
      {
        findTracesWithSpans: mockGetTracesWithSpans,
        findTraceFromStoredSpans: mockFromStoredSpans,
        findTraceIdsBySpanId: mockBySpanId,
        findTracesWithSpansByThreadIds: vi.fn(),
        listAllTracesForProject: vi.fn(),
        findTracesByThreadId: vi.fn(),
      },
      "legacy trace mapping",
    ),
    editOverlay: TraceEditOverlayService.create(MemoryTraceEditOverlayRepository.create()),
    evaluationRuns: refusingEvaluations(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTracesWithSpans.mockResolvedValue([]);
  mockResolveTraceIdByPrefix.mockResolvedValue([]);
  mockFromStoredSpans.mockResolvedValue([]);
  mockBySpanId.mockResolvedValue([]);
  mockByScenarioRunId.mockResolvedValue([]);
});

describe("given a project with traces stored in ClickHouse", () => {
  describe("when the caller passes a full trace id", () => {
    /** @scenario Full trace ID resolves exactly */
    it("returns the trace without ever scanning for a prefix", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace(FULL_TRACE_ID)]);

      const result = await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: FULL_TRACE_ID,
        protections,
      });

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

      const result = await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: "63dc535cea6335c506bc",
        protections,
      });

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
        .findById({
          authorization: OWN_READ,
          projectId: PROJECT_ID,
          traceId: "abc12345",
          protections,
        })
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
        makeService().findById({
          authorization: OWN_READ,
          projectId: PROJECT_ID,
          traceId: "deadbeef",
          protections,
        }),
      ).resolves.toBeUndefined();
      expect(mockResolveTraceIdByPrefix).toHaveBeenCalled();
    });
  });

  describe("when the prefix belongs to another project", () => {
    /** @scenario Prefix match is scoped to the current project */
    it("scans only the caller's project", async () => {
      await makeService().findById({
        authorization: OWN_READ,
        projectId: "project_b",
        traceId: "aaaa1111",
        protections,
      });

      expect(mockResolveTraceIdByPrefix.mock.calls[0]![0].projectId).toBe("project_b");
    });
  });

  describe("when the input is shorter than the minimum prefix", () => {
    /** @scenario Too-short prefix falls through to 404 */
    it("never scans", async () => {
      await expect(
        makeService().findById({
          authorization: OWN_READ,
          projectId: PROJECT_ID,
          traceId: "ab",
          protections,
        }),
      ).resolves.toBeUndefined();
      expect(mockResolveTraceIdByPrefix).not.toHaveBeenCalled();
    });
  });

  describe("when the input is not hexadecimal", () => {
    /** @scenario Non-hex input skips prefix scan and returns 404 */
    it("never scans", async () => {
      await expect(
        makeService().findById({
          authorization: OWN_READ,
          projectId: PROJECT_ID,
          traceId: "not-a-hex-id-zzzz",
          protections,
        }),
      ).resolves.toBeUndefined();
      expect(mockResolveTraceIdByPrefix).not.toHaveBeenCalled();
    });
  });

  describe("when the id is upper case and padded", () => {
    /** @scenario An uppercase or padded trace id is normalised */
    it("reads the lower-case hex id", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace(FULL_TRACE_ID)]);

      const result = await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: `  ${FULL_TRACE_ID.toUpperCase()}\n`,
        protections,
      });

      expect(result?.trace_id).toBe(FULL_TRACE_ID);
      expect(mockGetTracesWithSpans.mock.calls[0]![0].traceIds).toEqual([FULL_TRACE_ID]);
    });

    it("keeps the case of a non-hex SDK id", async () => {
      await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: " Trace_ABC ",
        protections,
      });

      expect(mockGetTracesWithSpans.mock.calls[0]![0].traceIds).toEqual(["Trace_ABC"]);
    });
  });

  describe("when the summary is not written yet but spans are stored", () => {
    it("answers the trace built from its spans, marked still ingesting", async () => {
      mockFromStoredSpans.mockResolvedValue([trace(FULL_TRACE_ID)]);

      const result = await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: FULL_TRACE_ID,
        protections,
      });

      expect(result?.trace_id).toBe(FULL_TRACE_ID);
      expect(result?.stillIngesting).toBe(true);
    });
  });

  describe("when the id is a span id", () => {
    it("answers the trace holding the span, saying how it was found", async () => {
      const spanId = "8f1c2d3e4a5b6c7d";
      mockBySpanId.mockResolvedValue([FULL_TRACE_ID]);
      mockGetTracesWithSpans
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([trace(FULL_TRACE_ID)]);

      const result = await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: spanId,
        protections,
      });

      expect(result?.trace_id).toBe(FULL_TRACE_ID);
      expect(result?.lookup).toEqual({ requestedId: spanId, resolvedFrom: "span_id" });
    });
  });

  describe("when no read finds the id", () => {
    const reads = () => ({
      exact: mockGetTracesWithSpans.mock.calls.length,
      fromSpans: mockFromStoredSpans.mock.calls.length,
      prefix: mockResolveTraceIdByPrefix.mock.calls.length,
      scenarioRun: mockByScenarioRunId.mock.calls.length,
      spanId: mockBySpanId.mock.calls.length,
    });

    /** @scenario A miss reads only what the id can be */
    it("reads a full trace id once and its stored spans once, and scans no span ids", async () => {
      await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: "f".repeat(32),
        protections,
      });

      expect(reads()).toEqual({ exact: 1, fromSpans: 1, prefix: 0, scenarioRun: 0, spanId: 0 });
    });

    it("scans span ids only for an id shaped like one", async () => {
      await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: "trace-from-a-custom-sdk",
        protections,
      });

      expect(reads()).toEqual({ exact: 1, fromSpans: 1, prefix: 0, scenarioRun: 0, spanId: 0 });
    });

    it("scans span ids for an OTel span id, after its prefix read", async () => {
      await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: "8f1c2d3e4a5b6c7d",
        protections,
      });

      expect(reads()).toEqual({ exact: 1, fromSpans: 1, prefix: 1, scenarioRun: 0, spanId: 1 });
    });
  });

  describe("when the id is a scenario run id", () => {
    const runId = "scenariorun_0005FFcHZ7IBvPE1OSWymml0ikKqB";

    it("answers the one trace the run produced", async () => {
      mockByScenarioRunId.mockResolvedValue([FULL_TRACE_ID]);
      mockGetTracesWithSpans
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([trace(FULL_TRACE_ID)]);

      const result = await makeService().findById({
        authorization: OWN_READ,
        projectId: PROJECT_ID,
        traceId: runId,
        protections,
      });

      expect(result?.lookup).toEqual({ requestedId: runId, resolvedFrom: "scenario_run_id" });
      expect(mockBySpanId).not.toHaveBeenCalled();
    });

    /** @scenario A scenario run with several traces lists them */
    it("refuses with every trace id when the run produced several", async () => {
      const traces = [FULL_TRACE_ID, "a".repeat(32)];
      mockByScenarioRunId.mockResolvedValue(traces);

      const failure = await makeService()
        .findById({ authorization: OWN_READ, projectId: PROJECT_ID, traceId: runId, protections })
        .catch((error: unknown) => error);

      expect(failure).toMatchObject({
        code: "scenario_run_has_many_traces",
        meta: { scenarioRunId: runId, candidateTraceIds: traces },
      });
    });
  });
});
