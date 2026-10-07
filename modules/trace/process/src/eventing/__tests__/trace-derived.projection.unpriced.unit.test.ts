/**
 * The analytics fold carries unpriced spans through its row, so a read-back resumes the count.
 * @see modules/trace/specs/trace-unpriced-cost.feature
 */
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
  TraceAnalyticsFoldProjection,
  type TraceAnalyticsData,
} from "../trace-derived.projection.ts";
import { createTestRuntime, createTestSpan } from "./trace-summary-test.fixtures.ts";

const runtime = createTestRuntime();
const projection = TraceAnalyticsFoldProjection.create({
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime,
});

function unpricedSpan({ spanId }: { spanId: string }) {
  return createTestSpan({
    spanId,
    name: "llm",
    spanAttributes: {
      "gen_ai.request.model": "my-finetune-v2",
      "gen_ai.usage.input_tokens": 500,
      "gen_ai.usage.output_tokens": 100,
    },
  });
}

describe("TraceAnalyticsFoldProjection unpriced spans", () => {
  describe("given a state with two unpriced spans", () => {
    /** @scenario "The analytics row keeps the unpriced count through a read-back" */
    it("keeps the count and the model when written and read back", () => {
      const folded = [
        unpricedSpan({ spanId: "a" }),
        unpricedSpan({ spanId: "b" }),
      ].reduce<TraceAnalyticsData>(
        (state, span) =>
          TraceAnalyticsFoldProjection.applySpanToAnalytics({ state, span, runtime }),
        { ...projection.init(), traceId: "trace-unpriced" },
      );

      const row = TraceAnalyticsFoldProjection.projectAnalyticsStateToRow({
        state: folded,
        tenantId: "tenant-unpriced",
        version: TRACE_ANALYTICS_PROJECTION_VERSION_LATEST,
      });
      const readBack = TraceAnalyticsFoldProjection.traceAnalyticsStateFromRow(row);

      expect(row.unpricedSpanCount).toBe(2);
      expect(row.unpricedModels).toEqual(["my-finetune-v2"]);
      expect(readBack.unpricedSpanCount).toBe(2);
      expect(readBack.unpricedModels).toEqual(["my-finetune-v2"]);
    });
  });
});
