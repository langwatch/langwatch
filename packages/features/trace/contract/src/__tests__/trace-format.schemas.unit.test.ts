/**
 * Coverage for `langWatchEventSchema`'s metric-key constraint
 * (specs/api-reference/tracked-event-validation.feature).
 */

import { describe, expect, it } from "vitest";
import { langWatchEventSchema } from "../trace-format.schemas";

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

describe("langWatchEventSchema", () => {
  describe("given a metric key", () => {
    describe("when the key contains the ASCII unit separator (0x1F)", () => {
      /** @scenario "Ingest rejects a metric key carrying the unit separator" */
      it("fails validation", () => {
        const result = langWatchEventSchema.safeParse({
          ...baseEvent,
          metrics: { "stars\x1fextra": 4 },
        });

        expect(result.success).toBe(false);
      });
    });

    describe("when the key is an ordinary string", () => {
      it("passes validation", () => {
        const result = langWatchEventSchema.safeParse({
          ...baseEvent,
          metrics: { stars: 4 },
        });

        expect(result.success).toBe(true);
      });
    });
  });
});
