import { describe, expect, it, vi } from "vitest";

import type { Span } from "~/server/tracer/types";

import { SpanStorageService } from "../span-storage.service";
import { TEASER_MAX_CHARS } from "../visibility-window.service";

const DAY_MS = 24 * 60 * 60 * 1000;

const makeSpan = (startedDaysAgo: number, id = "span-1"): Span =>
  ({
    span_id: id,
    trace_id: "trace-1",
    type: "llm",
    name: "call",
    input: { type: "text", value: "p".repeat(5000) },
    output: { type: "text", value: "q".repeat(5000) },
    timestamps: {
      started_at: Date.now() - startedDaysAgo * DAY_MS,
      finished_at: Date.now() - startedDaysAgo * DAY_MS + 1000,
    },
  }) as Span;

const makeService = (spans: Span[]) =>
  new SpanStorageService({
    getSpansByTraceId: vi.fn().mockResolvedValue(spans),
    getSpanByIds: vi.fn().mockResolvedValue(spans[0] ?? null),
    findSpansPaginated: vi
      .fn()
      .mockResolvedValue({ spans, total: spans.length }),
    findSpansSince: vi.fn().mockResolvedValue(spans),
  } as never);

describe("given a span storage read with a visibility gate", () => {
  describe("when a cutoff is passed and the span is older than it", () => {
    it("teases span content on getSpansByTraceId", async () => {
      const service = makeService([makeSpan(15)]);
      const spans = await service.getSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
        visibilityCutoffMs: Date.now() - 14 * DAY_MS,
      });
      expect((spans[0]?.input as { value: string }).value).toHaveLength(
        TEASER_MAX_CHARS,
      );
    });

    it("teases span content on getSpansPaginated and getSpansSince", async () => {
      const service = makeService([makeSpan(15)]);
      const cutoff = Date.now() - 14 * DAY_MS;
      const page = await service.getSpansPaginated({
        tenantId: "project-1",
        traceId: "trace-1",
        limit: 10,
        offset: 0,
        visibilityCutoffMs: cutoff,
      });
      const since = await service.getSpansSince({
        tenantId: "project-1",
        traceId: "trace-1",
        sinceStartTimeMs: 0,
        visibilityCutoffMs: cutoff,
      });
      expect((page.spans[0]?.input as { value: string }).value).toHaveLength(
        TEASER_MAX_CHARS,
      );
      expect((since[0]?.input as { value: string }).value).toHaveLength(
        TEASER_MAX_CHARS,
      );
    });

    it("teases a single span on getSpanById", async () => {
      const service = makeService([makeSpan(15)]);
      const span = await service.getSpanById({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        visibilityCutoffMs: Date.now() - 14 * DAY_MS,
      });
      expect((span?.input as { value: string }).value).toHaveLength(
        TEASER_MAX_CHARS,
      );
    });
  });

  describe("when the span is within the window", () => {
    it("returns full content", async () => {
      const service = makeService([makeSpan(5)]);
      const spans = await service.getSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
        visibilityCutoffMs: Date.now() - 14 * DAY_MS,
      });
      expect((spans[0]?.input as { value: string }).value).toHaveLength(5000);
    });
  });

  describe("when no cutoff is passed (internal callers)", () => {
    it("returns spans untouched", async () => {
      const service = makeService([makeSpan(40)]);
      const spans = await service.getSpansByTraceId({
        tenantId: "project-1",
        traceId: "trace-1",
      });
      expect((spans[0]?.input as { value: string }).value).toHaveLength(5000);
    });
  });
});
