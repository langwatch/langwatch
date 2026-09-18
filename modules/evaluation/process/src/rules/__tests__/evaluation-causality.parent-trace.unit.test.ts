/**
 * The `traceparent` an evaluation hands the engine, so its spans land under the
 * trace being evaluated rather than as an orphan beside it.
 * @see specs/monitors/online-evaluator-loop-prevention.feature
 */
import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { tryExtractParentTraceForNlpgo } from "../evaluation-causality.rules.ts";

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const ROOT_SPAN_ID = "b7ad6b7169203331";

const traceWith = ({
  traceId,
  spanId,
  parentId = null,
}: {
  traceId: string;
  spanId: string;
  parentId?: string | null;
}): Trace =>
  ({
    trace_id: traceId,
    project_id: "project_1",
    input: { value: "hello" },
    output: { value: "world" },
    timestamps: { started_at: 0, inserted_at: 0 },
    spans: [
      {
        span_id: spanId,
        parent_id: parentId,
        trace_id: traceId,
        type: "span",
        timestamps: { started_at: 0, finished_at: 0 },
      },
    ],
  }) as unknown as Trace;

describe("given a trace the evaluation is running against", () => {
  describe("when its ids are the OTel ones", () => {
    /** @scenario "extractParentTraceForNlpgo returns context for valid OTel trace" */
    it("hands over the trace id and the root span to parent the evaluation's spans on", () => {
      const parent = tryExtractParentTraceForNlpgo(
        traceWith({ traceId: TRACE_ID, spanId: ROOT_SPAN_ID }),
      );

      expect(parent).toEqual({ traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID });
    });

    it("lowercases both, so a caller may hold either case", () => {
      const parent = tryExtractParentTraceForNlpgo(
        traceWith({ traceId: TRACE_ID.toUpperCase(), spanId: ROOT_SPAN_ID.toUpperCase() }),
      );

      expect(parent).toEqual({ traceId: TRACE_ID, parentSpanId: ROOT_SPAN_ID });
    });
  });

  describe("when the trace carries an id from before OTel ids", () => {
    /** @scenario "extractParentTraceForNlpgo returns undefined for legacy trace_id shapes" */
    it("hands over nothing, rather than a parent the waterfall cannot resolve", () => {
      expect(
        tryExtractParentTraceForNlpgo(
          traceWith({ traceId: "trace_abc123xyz", spanId: ROOT_SPAN_ID }),
        ),
      ).toBeUndefined();
    });

    /** @scenario "extractParentTraceForNlpgo returns undefined for legacy trace_id shapes" */
    it("hands over nothing when the root span's id is not an OTel one either", () => {
      expect(
        tryExtractParentTraceForNlpgo(
          traceWith({ traceId: TRACE_ID, spanId: "span_legacy_format" }),
        ),
      ).toBeUndefined();
    });
  });

  describe("when nothing in the trace can be a parent", () => {
    it("hands over nothing for a trace with no parentless span, and for no trace at all", () => {
      expect(
        tryExtractParentTraceForNlpgo(
          traceWith({ traceId: TRACE_ID, spanId: ROOT_SPAN_ID, parentId: "0000000000000099" }),
        ),
      ).toBeUndefined();
      expect(tryExtractParentTraceForNlpgo(undefined)).toBeUndefined();
    });
  });
});
