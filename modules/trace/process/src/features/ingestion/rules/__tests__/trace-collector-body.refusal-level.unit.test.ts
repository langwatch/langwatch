/**
 * @vitest-environment node
 * Every body the collector refuses with a 400 is the sender's mistake: each refusal logs at
 * warn, so none of them raises a New Error Signature alert.
 */
import type * as observabilityModule from "@langwatch/observability";
import { createTestLogger } from "@langwatch/test-harness";
import type { Span } from "@langwatch/trace-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testLog = createTestLogger();
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => testLog.logger,
}));

const { findEvaluationRejection, findSpanRejection, resolveTraceId } =
  await import("../trace-collector-body.rules.ts");

const NOW_SECONDS = Math.floor(Date.now() / 1000);

/** A span the schema accepts: only the trace id and the timestamps vary between cases. */
function span(input: { spanId: string; traceId: string; timestamps?: Span["timestamps"] }): Span {
  const now = Date.now();
  return {
    type: "span",
    span_id: input.spanId,
    trace_id: input.traceId,
    timestamps: input.timestamps ?? { started_at: now, finished_at: now },
  };
}

function expectRefusedAtWarn(rejection: unknown) {
  expect(rejection).toMatchObject({ rejected: true, status: 400 });
  expect(testLog.lines.filter((line) => line.level === 40)).not.toEqual([]);
  expect(testLog.lines.filter((line) => line.level >= 50)).toEqual([]);
}

beforeEach(() => {
  testLog.lines.length = 0;
});

describe("given a body the collector refuses", () => {
  describe("when an evaluation has no passed, score or label", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const body = { evaluations: [{ id: "eval-1", name: "check" }] };

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
      };

      expectRefusedAtWarn(findEvaluationRejection(body, "project_1"));
    });
  });

  describe("when no span carries a trace id", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const spans = [span({ spanId: "span-1", traceId: "" })];

      expectRefusedAtWarn(resolveTraceId(spans, { projectId: "project_1", nullableTraceId: null }));
    });
  });

  describe("when the spans belong to different traces", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const spans = [
        span({ spanId: "span-1", traceId: "trace-1" }),
        span({ spanId: "span-2", traceId: "trace-2" }),
      ];

      expectRefusedAtWarn(
        resolveTraceId(spans, { projectId: "project_1", nullableTraceId: "trace-1" }),
      );
    });
  });

  describe("when a span's timestamps are in seconds", () => {
    /** @scenario Every collector refusal logs at warning level */
    it("logs the refusal at warn, never error", () => {
      const spans = [
        span({
          spanId: "span-1",
          traceId: "trace-1",
          timestamps: { started_at: NOW_SECONDS, finished_at: NOW_SECONDS },
        }),
      ];

      expectRefusedAtWarn(findSpanRejection(spans, { projectId: "project_1", traceId: "trace-1" }));
    });
  });
});
