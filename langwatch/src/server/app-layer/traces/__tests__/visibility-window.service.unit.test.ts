import { describe, expect, it, vi } from "vitest";

import type { Span, Trace } from "~/server/tracer/types";

import {
  TEASER_FRACTION,
  TEASER_MAX_CHARS,
  TEASER_MIN_CHARS,
  VisibilityWindowService,
  redactSpanContent,
  redactTraceContent,
  teaserOf,
} from "../visibility-window.service";

const DAY_MS = 24 * 60 * 60 * 1000;

const makeTrace = (overrides: Partial<Trace> = {}): Trace =>
  ({
    trace_id: "trace-1",
    project_id: "project-1",
    metadata: { labels: ["checkout"], thread_id: "thread-1" },
    timestamps: {
      started_at: Date.now() - 15 * DAY_MS,
      inserted_at: Date.now() - 15 * DAY_MS,
      updated_at: Date.now() - 15 * DAY_MS,
    },
    input: { value: "x".repeat(5000) },
    output: { value: "y".repeat(5000) },
    error: {
      has_error: true,
      message: "boom: " + "z".repeat(5000),
      stacktrace: ["at " + "s".repeat(500)],
    },
    metrics: { total_cost: 0.42, prompt_tokens: 100 },
    spans: [],
    ...overrides,
  }) as Trace;

const makeSpan = (overrides: Partial<Span> = {}): Span =>
  ({
    span_id: "span-1",
    trace_id: "trace-1",
    type: "llm",
    name: "gpt-call",
    input: { type: "text", value: "p".repeat(5000) },
    output: { type: "text", value: "q".repeat(5000) },
    error: null,
    timestamps: { started_at: 0, finished_at: 1 },
    params: { temperature: 0.2, system_prompt: "secret ".repeat(200) },
    ...overrides,
  }) as Span;

describe("teaserOf", () => {
  describe("when the text is long", () => {
    it("caps the teaser at TEASER_MAX_CHARS", () => {
      expect(teaserOf("a".repeat(5000))).toHaveLength(TEASER_MAX_CHARS);
    });

    it("keeps 10% when that lands between the floor and the cap", () => {
      const text = "b".repeat(1000);
      expect(teaserOf(text)).toHaveLength(
        Math.ceil(text.length * TEASER_FRACTION),
      );
    });
  });

  describe("when the text is shorter than the floor", () => {
    it("returns the full text untouched", () => {
      const text = "c".repeat(40);
      expect(teaserOf(text)).toBe(text);
    });
  });

  describe("when the text length equals the floor boundary", () => {
    it("keeps exactly TEASER_MIN_CHARS for a 60-char text", () => {
      expect(teaserOf("d".repeat(60))).toHaveLength(TEASER_MIN_CHARS);
    });
  });
});

describe("redactTraceContent", () => {
  it("truncates input, output, and error bodies to the teaser", () => {
    const redacted = redactTraceContent(makeTrace());
    expect(redacted.input?.value).toHaveLength(TEASER_MAX_CHARS);
    expect(redacted.output?.value).toHaveLength(TEASER_MAX_CHARS);
    expect(redacted.error?.message).toHaveLength(TEASER_MAX_CHARS);
    // joined stacktrace is 503 chars -> ceil(10%) = 51 kept
    expect(redacted.error?.stacktrace.join("")).toHaveLength(51);
  });

  it("marks the trace as redacted by the visibility window", () => {
    expect(redactTraceContent(makeTrace()).redacted_by_visibility_window).toBe(
      true,
    );
  });

  it("keeps metadata, metrics, and timestamps unchanged", () => {
    const trace = makeTrace();
    const redacted = redactTraceContent(trace);
    expect(redacted.metadata).toEqual(trace.metadata);
    expect(redacted.metrics).toEqual(trace.metrics);
    expect(redacted.timestamps).toEqual(trace.timestamps);
    expect(redacted.trace_id).toBe(trace.trace_id);
  });

  it("does not mutate the original trace", () => {
    const trace = makeTrace();
    redactTraceContent(trace);
    expect(trace.input?.value).toHaveLength(5000);
  });
});

describe("redactSpanContent", () => {
  it("truncates text input and output values to the teaser", () => {
    const redacted = redactSpanContent(makeSpan());
    expect((redacted.input as { value: string }).value).toHaveLength(
      TEASER_MAX_CHARS,
    );
    expect((redacted.output as { value: string }).value).toHaveLength(
      TEASER_MAX_CHARS,
    );
  });

  it("truncates string param values but keeps non-string params", () => {
    const redacted = redactSpanContent(makeSpan());
    const params = redacted.params as Record<string, unknown>;
    expect((params.system_prompt as string).length).toBeLessThanOrEqual(
      TEASER_MAX_CHARS,
    );
    expect(params.temperature).toBe(0.2);
  });

  it("truncates chat-message contents individually", () => {
    const span = makeSpan({
      input: {
        type: "chat_messages",
        value: [
          { role: "system", content: "s".repeat(4000) },
          { role: "user", content: "hi" },
        ],
      },
    });
    const redacted = redactSpanContent(span);
    const messages = (redacted.input as { value: { content?: string | null }[] })
      .value;
    expect(messages[0]?.content).toHaveLength(TEASER_MAX_CHARS);
    expect(messages[1]?.content).toBe("hi");
  });

  it("keeps span name, type, timestamps, and metrics visible", () => {
    const span = makeSpan();
    const redacted = redactSpanContent(span);
    expect(redacted.name).toBe(span.name);
    expect(redacted.type).toBe(span.type);
    expect(redacted.timestamps).toEqual(span.timestamps);
  });

  it("truncates error message and stacktrace", () => {
    const span = makeSpan({
      error: {
        has_error: true,
        message: "e".repeat(2000),
        stacktrace: ["t".repeat(2000)],
      },
    });
    const redacted = redactSpanContent(span);
    // 2000-char message -> ceil(10%) = 200 kept
    expect(redacted.error?.message).toHaveLength(200);
  });
});

describe("VisibilityWindowService.getVisibilityCutoffMs", () => {
  const makeService = (plan: unknown, shouldThrow = false) => {
    const planProvider = {
      getActivePlan: shouldThrow
        ? vi.fn().mockRejectedValue(new Error("db down"))
        : vi.fn().mockResolvedValue(plan),
    };
    return new VisibilityWindowService(planProvider as never);
  };

  describe("when the plan has no visibility window", () => {
    it("returns null so nothing is redacted", async () => {
      const service = makeService({ free: false, visibilityDays: null });
      await expect(
        service.getVisibilityCutoffMs({ organizationId: "org-1" }),
      ).resolves.toBeNull();
    });
  });

  describe("when the plan is free with a 14-day window", () => {
    it("returns a cutoff 14 days in the past", async () => {
      const service = makeService({ free: true, visibilityDays: 14 });
      const cutoff = await service.getVisibilityCutoffMs({
        organizationId: "org-1",
      });
      expect(cutoff).toBeGreaterThan(Date.now() - 14 * DAY_MS - 5000);
      expect(cutoff).toBeLessThanOrEqual(Date.now() - 14 * DAY_MS + 5000);
    });
  });

  describe("when plan resolution throws", () => {
    it("fails closed with the free-tier cutoff", async () => {
      const service = makeService(null, true);
      const cutoff = await service.getVisibilityCutoffMs({
        organizationId: "org-1",
      });
      expect(cutoff).not.toBeNull();
      expect(cutoff).toBeLessThanOrEqual(Date.now() - 14 * DAY_MS + 5000);
    });
  });
});
