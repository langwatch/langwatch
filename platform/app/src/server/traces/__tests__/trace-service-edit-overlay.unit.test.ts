/**
 * @vitest-environment node
 *
 * The `withEditOverlay` read seam on TraceService, exercised at the real seam:
 * the ClickHouse read, the coding-agent enrichment and the correction store are
 * mocked boundaries; the ordering, the batching and the pure applier run for
 * real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LogRecordStorageService } from "~/server/app-layer/traces/log-record-storage.service";
import type { Span, Trace } from "~/server/tracer/types";
import type { Protections } from "~/server/traces/protections";
import type { TraceEditOverlayPatch } from "../edit-overlay/traceEditOverlay.schemas";

const {
  mockGetTracesWithSpans,
  mockGetTracesByThreadId,
  mockGetTracesWithSpansByThreadIds,
  mockGetAllTracesForProject,
  mockGetPatchesByTraceIds,
  mockEnrichCodingAgentSpansFromLogs,
} = vi.hoisted(() => ({
  mockGetTracesWithSpans: vi.fn(),
  mockGetTracesByThreadId: vi.fn(),
  mockGetTracesWithSpansByThreadIds: vi.fn(),
  mockGetAllTracesForProject: vi.fn(),
  mockGetPatchesByTraceIds: vi.fn(),
  mockEnrichCodingAgentSpansFromLogs: vi.fn(),
}));

vi.mock("../clickhouse-trace.service", () => ({
  ClickHouseTraceService: Object.assign(vi.fn(), {
    create: () => ({
      getTracesWithSpans: mockGetTracesWithSpans,
      getTracesByThreadId: mockGetTracesByThreadId,
      getTracesWithSpansByThreadIds: mockGetTracesWithSpansByThreadIds,
      getAllTracesForProject: mockGetAllTracesForProject,
      resolveTraceIdByPrefix: vi.fn().mockResolvedValue([]),
    }),
  }),
}));

vi.mock("../edit-overlay/traceEditOverlay.service", () => ({
  TraceEditOverlayService: Object.assign(vi.fn(), {
    create: () => ({ getPatchesByTraceIds: mockGetPatchesByTraceIds }),
  }),
}));

vi.mock(
  "~/server/app-layer/traces/claude-code-log-enrichment",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/server/app-layer/traces/claude-code-log-enrichment")
    >()),
    enrichCodingAgentSpansFromLogs: mockEnrichCodingAgentSpansFromLogs,
  }),
);

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForTenant: vi.fn(),
  isClickHouseEnabled: () => false,
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

import { CODING_AGENT_ORIGIN } from "~/server/app-layer/traces/claude-code-log-enrichment";
import { TraceService } from "../trace.service";

const PROJECT_ID = "project_test";

const protections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

const span = (overrides: Partial<Span> & Pick<Span, "span_id">): Span =>
  ({
    trace_id: "trace-1",
    parent_id: null,
    type: "span",
    name: "captured",
    output: { type: "text", value: "captured output" },
    timestamps: { started_at: 1_000, finished_at: 2_000 },
    ...overrides,
  }) as Span;

const trace = (traceId: string, overrides: Partial<Trace> = {}): Trace =>
  ({
    trace_id: traceId,
    project_id: PROJECT_ID,
    metadata: {},
    timestamps: { started_at: 1_000, inserted_at: 1_000, updated_at: 1_000 },
    output: { value: "captured output" },
    spans: [span({ span_id: `${traceId}-span`, trace_id: traceId })],
    ...overrides,
  }) as Trace;

const traceOutputPatch = (output: string): TraceEditOverlayPatch => ({
  version: 1,
  spans: [],
  deletedSpanIds: [],
  trace: { output: { value: output } },
});

const buildService = () =>
  TraceService.create({} as never, undefined, {} as unknown as LogRecordStorageService);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPatchesByTraceIds.mockResolvedValue(new Map());
  mockEnrichCodingAgentSpansFromLogs.mockImplementation(
    ({ spans }: { spans: Span[] }) => spans,
  );
});

describe("TraceService read seam for reviewer corrections", () => {
  describe("given the add-to-dataset read asks for corrections", () => {
    /** @scenario "The add-to-dataset read returns the corrected trace" */
    it("returns the corrected trace", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace("trace-1")]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([
          [
            "trace-1",
            {
              version: 1,
              spans: [{ spanId: "trace-1-span", name: "cleaned up" }],
              deletedSpanIds: [],
            } satisfies TraceEditOverlayPatch,
          ],
        ]),
      );

      const [corrected] = await buildService().getTracesWithSpans(
        PROJECT_ID,
        ["trace-1"],
        protections,
        undefined,
        { full: true, withEditOverlay: true },
      );

      expect(corrected?.spans[0]?.name).toBe("cleaned up");
    });
  });

  describe("given a reader that does not ask for corrections", () => {
    /** @scenario "Readers that do not ask for corrections get the original" */
    it("returns the captured trace and never reads the correction store", async () => {
      const captured = trace("trace-1");
      mockGetTracesWithSpans.mockResolvedValue([captured]);

      const [result] = await buildService().getTracesWithSpans(
        PROJECT_ID,
        ["trace-1"],
        protections,
      );

      expect(result?.spans[0]?.name).toBe("captured");
      expect(mockGetPatchesByTraceIds).not.toHaveBeenCalled();

      const single = await buildService().getById(PROJECT_ID, "trace-1", protections);
      expect(single?.spans[0]?.name).toBe("captured");
      expect(mockGetPatchesByTraceIds).not.toHaveBeenCalled();
    });
  });

  describe("given a page of several corrected traces", () => {
    /** @scenario "A page of traces fetches its corrections in one read" */
    it("fetches the corrections once for the whole page", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        trace("trace-1"),
        trace("trace-2"),
        trace("trace-3"),
      ]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([["trace-2", traceOutputPatch("only trace two")]]),
      );

      const traces = await buildService().getTracesWithSpans(
        PROJECT_ID,
        ["trace-1", "trace-2", "trace-3"],
        protections,
        undefined,
        { withEditOverlay: true },
      );

      expect(mockGetPatchesByTraceIds).toHaveBeenCalledTimes(1);
      expect(mockGetPatchesByTraceIds).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        traceIds: ["trace-1", "trace-2", "trace-3"],
      });
      expect(traces.map((t) => t.output?.value)).toEqual([
        "captured output",
        "only trace two",
        "captured output",
      ]);
    });
  });

  describe("given a conversation whose traces are corrected differently", () => {
    /** @scenario "Thread mode applies each trace its own correction" */
    it("gives each trace only its own correction", async () => {
      mockGetTracesWithSpansByThreadIds.mockResolvedValue([
        trace("trace-1"),
        trace("trace-2"),
      ]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([
          ["trace-1", traceOutputPatch("first correction")],
          ["trace-2", traceOutputPatch("second correction")],
        ]),
      );

      const traces = await buildService().getTracesWithSpansByThreadIds(
        PROJECT_ID,
        ["thread-1"],
        protections,
        { full: true, withEditOverlay: true },
      );

      expect(traces.map((t) => t.output?.value)).toEqual([
        "first correction",
        "second correction",
      ]);
    });
  });

  describe("given a trace whose captured content is resolved at read time", () => {
    /** @scenario "Corrections are applied after the trace content is fully resolved" */
    it("lets the correction win over the resolved content", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        trace("trace-1", {
          metadata: { "langwatch.origin": CODING_AGENT_ORIGIN },
        }),
      ]);
      mockEnrichCodingAgentSpansFromLogs.mockImplementation(
        ({ spans }: { spans: Span[] }) =>
          spans.map((s) => ({
            ...s,
            output: { type: "text" as const, value: "resolved from storage" },
          })),
      );
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([
          [
            "trace-1",
            {
              version: 1,
              spans: [
                {
                  spanId: "trace-1-span",
                  output: { type: "text", value: "corrected output" },
                },
              ],
              deletedSpanIds: [],
            } satisfies TraceEditOverlayPatch,
          ],
        ]),
      );

      const corrected = await buildService().getById(PROJECT_ID, "trace-1", protections, {
        full: true,
        withEditOverlay: true,
      });

      expect(mockEnrichCodingAgentSpansFromLogs).toHaveBeenCalled();
      expect(corrected?.spans[0]?.output).toEqual({
        type: "text",
        value: "corrected output",
      });
    });
  });

  describe("given an attribute rule that hides one of the corrected attributes", () => {
    it("does not let the correction put the hidden attribute back", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace("trace-1")]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([
          [
            "trace-1",
            {
              version: 1,
              spans: [
                {
                  spanId: "trace-1-span",
                  params: {
                    model: "gpt-5-mini",
                    gen_ai: { prompt: { id: "secret-prompt" } },
                  },
                },
              ],
              deletedSpanIds: [],
            } satisfies TraceEditOverlayPatch,
          ],
        ]),
      );

      const [corrected] = await buildService().getTracesWithSpans(
        PROJECT_ID,
        ["trace-1"],
        {
          ...protections,
          hiddenAttributes: [{ pattern: "gen_ai.prompt.id", visibleTo: "Admins" }],
        },
        undefined,
        { withEditOverlay: true },
      );

      expect(corrected?.spans[0]?.params).toEqual({
        model: "gpt-5-mini",
        gen_ai: { prompt: { id: "[REDACTED] (visible to Admins)" } },
      });
    });

    it("drops the corrected attributes for a viewer who may not read input", async () => {
      mockGetTracesWithSpans.mockResolvedValue([
        trace("trace-1", {
          spans: [
            span({
              span_id: "trace-1-span",
              trace_id: "trace-1",
              params: { model: "[REDACTED] (visible to Admins)" },
            }),
          ],
        }),
      ]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([
          [
            "trace-1",
            {
              version: 1,
              spans: [
                {
                  spanId: "trace-1-span",
                  name: "cleaned up",
                  params: { model: "gpt-5-mini" },
                },
              ],
              deletedSpanIds: [],
            } satisfies TraceEditOverlayPatch,
          ],
        ]),
      );

      const [corrected] = await buildService().getTracesWithSpans(
        PROJECT_ID,
        ["trace-1"],
        { ...protections, canSeeCapturedInput: false },
        undefined,
        { withEditOverlay: true },
      );

      expect(corrected?.spans[0]?.params).toEqual({
        model: "[REDACTED] (visible to Admins)",
      });
      expect(corrected?.spans[0]?.name).toBe("cleaned up");
    });
  });

  describe("given a viewer who may not read captured output", () => {
    it("keeps the captured output and still applies the structural edits", async () => {
      mockGetTracesWithSpans.mockResolvedValue([trace("trace-1")]);
      mockGetPatchesByTraceIds.mockResolvedValue(
        new Map([
          [
            "trace-1",
            {
              version: 1,
              trace: { output: { value: "corrected trace output" } },
              spans: [{ spanId: "trace-1-span", name: "cleaned up" }],
              deletedSpanIds: [],
            } satisfies TraceEditOverlayPatch,
          ],
        ]),
      );

      const [corrected] = await buildService().getTracesWithSpans(
        PROJECT_ID,
        ["trace-1"],
        { ...protections, canSeeCapturedOutput: false },
        undefined,
        { withEditOverlay: true },
      );

      expect(corrected?.output).toEqual({ value: "captured output" });
      expect(corrected?.spans[0]?.name).toBe("cleaned up");
    });
  });
});
