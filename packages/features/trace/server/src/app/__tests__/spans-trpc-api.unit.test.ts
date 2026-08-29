/**
 * @vitest-environment node
 *
 * The `spans.*` tRPC surface: the waterfall order a trace's spans come back
 * in, and the two ways a prompt-studio read can end.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { SpansTrpcApi } from "../../transport/api-trpc/spans.api";
import { TraceApp, type TraceAppDependencies } from "../trace.app";
import type { TraceLegacyReadPort } from "../../ports/trace-legacy-read.port";

type TestContext = { app: { traces: TraceApp } };

/**
 * The App holds every service the trace feature's five doors reach; the two
 * procedures under test reach exactly one of them. The bag is narrowed rather
 * than stubbed whole because a complete one would mean hand-writing four
 * service contracts (`TraceService`, `EvaluationService`, `CodingAgentService`,
 * `TraceCanonicalisationService`) that nothing here calls — and a reach for any
 * of them throws on the missing property, which is the loud failure we want.
 */
function traceApp(read: TraceLegacyReadPort): TraceApp {
  return TraceApp.create({ traces: { read } } as unknown as TraceAppDependencies);
}

function harness({
  getTracesWithSpans = vi.fn(async () => []),
  getSpanForPromptStudio = vi.fn(async () => null),
}: {
  getTracesWithSpans?: ReturnType<typeof vi.fn>;
  getSpanForPromptStudio?: ReturnType<typeof vi.fn>;
} = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  const getViewerProtections = vi.fn(async () => ({ canSeeCosts: true }));

  const router = SpansTrpcApi.create(
    trpc,
    { protected: trpc.procedure, policy: () => (procedure) => procedure },
    { getViewerProtections },
  );

  return {
    getViewerProtections,
    getTracesWithSpans,
    getSpanForPromptStudio,
    caller: router.createCaller({
      app: {
        traces: traceApp({
          getTracesWithSpans,
          getSpanForPromptStudio,
        } as unknown as TraceLegacyReadPort),
      },
    }),
  };
}

const span = (spanId: string, startedAt: number, finishedAt: number) => ({
  span_id: spanId,
  timestamps: { started_at: startedAt, finished_at: finishedAt },
});

describe("SpansTrpcApi", () => {
  describe("given a trace whose spans are stored out of order", () => {
    it("returns them earliest-start first", async () => {
      const { caller } = harness({
        getTracesWithSpans: vi.fn(async () => [
          {
            trace_id: "trace-1",
            spans: [span("late", 200, 300), span("early", 100, 150)],
          },
        ]) as ReturnType<typeof vi.fn>,
      });

      const spans = await caller.getAllForTrace({
        projectId: "project-1",
        traceId: "trace-1",
      });

      expect(spans.map((s: { span_id: string }) => s.span_id)).toEqual(["early", "late"]);
    });

    /**
     * A parent starts with its first child and ends after it, so ordering ties
     * by longest-first is what keeps a parent above the child it contains.
     */
    it("puts the longer of two spans that start together first", async () => {
      const { caller } = harness({
        getTracesWithSpans: vi.fn(async () => [
          {
            trace_id: "trace-1",
            spans: [span("child", 100, 120), span("parent", 100, 400)],
          },
        ]) as ReturnType<typeof vi.fn>,
      });

      const spans = await caller.getAllForTrace({
        projectId: "project-1",
        traceId: "trace-1",
      });

      expect(spans.map((s: { span_id: string }) => s.span_id)).toEqual(["parent", "child"]);
    });
  });

  describe("given the project holds no such trace", () => {
    it("answers with no spans rather than failing", async () => {
      const { caller } = harness();
      await expect(
        caller.getAllForTrace({ projectId: "project-1", traceId: "missing" }),
      ).resolves.toEqual([]);
    });
  });

  describe("given the span is not an LLM span", () => {
    it("refuses the prompt-studio read as not found", async () => {
      const { caller } = harness();
      await expect(
        caller.getForPromptStudio({ projectId: "project-1", spanId: "span-1" }),
      ).rejects.toBeInstanceOf(TRPCError);
    });
  });

  describe("given the span is an LLM span", () => {
    it("answers with what the prompt studio opens on", async () => {
      const { caller } = harness({
        getSpanForPromptStudio: vi.fn(async () => ({ spanId: "span-1" })) as ReturnType<
          typeof vi.fn
        >,
      });

      await expect(
        caller.getForPromptStudio({ projectId: "project-1", spanId: "span-1" }),
      ).resolves.toMatchObject({ spanId: "span-1" });
    });
  });
});
