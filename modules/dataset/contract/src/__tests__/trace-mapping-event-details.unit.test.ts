/**
 * Mapping one detail of a tracked event by its plain name.
 * See specs/datasets/add-to-dataset-event-mapping.feature.
 */

import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TRACE_MAPPINGS } from "../trace-mapping.ts";

const timestamps = { started_at: 1_000, inserted_at: 1_000, updated_at: 1_000 };

const trace: Trace = {
  trace_id: "trace-1",
  project_id: "project-1",
  metadata: {},
  timestamps,
  spans: [],
  events: [
    {
      event_id: "event-1",
      event_type: "thumbs_up_down",
      project_id: "project-1",
      trace_id: "trace-1",
      timestamps,
      metrics: { vote: -1 },
      event_details: {
        "event.type": "thumbs_up_down",
        "event.details.feedback": "too slow",
      },
    },
  ],
};

describe("given a trace with a thumbs_up_down event whose feedback is too slow", () => {
  describe("when a column maps one event detail", () => {
    /** @scenario "Mapping an event detail by its plain name" */
    it("returns only that detail", () => {
      expect(
        TRACE_MAPPINGS.events.mapping({
          trace,
          key: "thumbs_up_down",
          subkey: "event_details.feedback",
        }),
      ).toEqual(["too slow"]);
    });

    it("still resolves the stored spelling", () => {
      expect(
        TRACE_MAPPINGS.events.mapping({
          trace,
          key: "thumbs_up_down",
          subkey: "event_details.event.details.feedback",
        }),
      ).toEqual(["too slow"]);
    });
  });

  describe("when the subkeys for the event type are listed", () => {
    /** @scenario "Event detail subkeys are offered by their plain name" */
    it("offers each detail by its plain name", () => {
      const keys = TRACE_MAPPINGS.events
        .subkeys([trace], "thumbs_up_down")
        .map((option) => option.key);

      expect(keys).toContain("event_details.feedback");
    });
  });
});
