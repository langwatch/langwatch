/**
 * @vitest-environment node
 * Every body the collector refuses with a 400 is the sender's mistake: each refusal logs at
 * warn, so none of them raises a New Error Signature alert.
 */
import type * as observabilityModule from "@langwatch/observability";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerSpies = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => loggerSpies,
}));

const { findEvaluationRejection, findSpanRejection, resolveTraceId } =
  await import("../trace-collector-body.rules.ts");

type CollectorBody = Parameters<typeof findEvaluationRejection>[0];
type Spans = Parameters<typeof findSpanRejection>[0];

const NOW = Date.now();
const NOW_SECONDS = Math.floor(NOW / 1000);

function expectRefusedAtWarn(rejection: unknown) {
  expect(rejection).toMatchObject({ rejected: true, status: 400 });
  expect(loggerSpies.warn).toHaveBeenCalled();
  expect(loggerSpies.error).not.toHaveBeenCalled();
}

beforeEach(() => {
  loggerSpies.warn.mockClear();
  loggerSpies.error.mockClear();
});

describe("given a body the collector refuses", () => {
  describe("when an evaluation has no passed, score or label", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const body = { evaluations: [{ id: "eval-1", name: "check" }] } as unknown as CollectorBody;

      expectRefusedAtWarn(findEvaluationRejection(body, "project_1"));
    });
  });

  describe("when an evaluation's timestamps are in seconds", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const body = {
        evaluations: [
          {
            id: "eval-1",
            name: "check",
            passed: true,
            timestamps: { started_at: NOW_SECONDS, finished_at: NOW_SECONDS },
          },
        ],
      } as unknown as CollectorBody;

      expectRefusedAtWarn(findEvaluationRejection(body, "project_1"));
    });
  });

  describe("when no span carries a trace id", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const spans = [{ type: "span", span_id: "span-1" }] as unknown as Spans;

      expectRefusedAtWarn(resolveTraceId(spans, { projectId: "project_1", nullableTraceId: null }));
    });
  });

  describe("when the spans belong to different traces", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const spans = [
        { type: "span", span_id: "span-1", trace_id: "trace-1" },
        { type: "span", span_id: "span-2", trace_id: "trace-2" },
      ] as unknown as Spans;

      expectRefusedAtWarn(
        resolveTraceId(spans, { projectId: "project_1", nullableTraceId: "trace-1" }),
      );
    });
  });

  describe("when a span's timestamps are in seconds", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const spans = [
        {
          type: "span",
          span_id: "span-1",
          trace_id: "trace-1",
          timestamps: { started_at: NOW_SECONDS, finished_at: NOW_SECONDS },
        },
      ] as unknown as Spans;

      expectRefusedAtWarn(findSpanRejection(spans, { projectId: "project_1", traceId: "trace-1" }));
    });
  });
});
