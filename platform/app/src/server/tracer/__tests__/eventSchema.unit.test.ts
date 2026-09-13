/**
 * Coverage for `eventSchema`'s metric-key constraint
 * (specs/api-reference/tracked-event-validation.feature).
 *
 * A metric key survives into the composite-key encoding the event drilldown
 * decodes (`<key>\x1F<value>`, see EVENT_METRIC_SEP in
 * `query-language/eventMetrics.ts`). A key carrying that separator itself
 * makes the split ambiguous, so ingest rejects it rather than accept an
 * event whose metric can never surface in the explorer.
 */

import { describe, expect, it } from "vitest";
import { eventSchema } from "../types";

const baseEvent = {
  event_id: "event_1",
  event_type: "custom_marker",
  project_id: "project_1",
  event_details: {},
  trace_id: "trace_1",
  timestamps: {
    started_at: 0,
    inserted_at: 0,
    updated_at: 0,
  },
};

describe("eventSchema", () => {
  describe("given a metric key", () => {
    describe("when the key contains the ASCII unit separator (0x1F)", () => {
      /** @scenario "Ingest rejects a metric key carrying the unit separator" */
      it("fails validation", () => {
        const result = eventSchema.safeParse({
          ...baseEvent,
          metrics: { "stars\x1fextra": 4 },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when the key is an ordinary string", () => {
      it("passes validation", () => {
        const result = eventSchema.safeParse({
          ...baseEvent,
          metrics: { stars: 4 },
        });

        expect(result.success).toBe(true);
      });
    });
  });
});
