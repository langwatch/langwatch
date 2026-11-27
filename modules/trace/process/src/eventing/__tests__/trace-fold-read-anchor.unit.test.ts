/**
 * @vitest-environment node
 * Spec: specs/trace-processing/backfilled-trace-read-anchor.feature
 */
import { traceFoldReadAnchorMs } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createSpanReceivedEvent } from "./trace-summary-test.fixtures.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 12);
const SPAN_START_MS = NOW - 9 * DAY_MS;

describe("traceFoldReadAnchorMs()", () => {
  describe("given a span that started nine days before it arrived", () => {
    /** @scenario "A trace fold anchors a span on the span's own start time" */
    it("anchors the span-received event on the span's start time", () => {
      const event = createSpanReceivedEvent({
        occurredAt: NOW,
        startTimeUnixNano: `${SPAN_START_MS}000000`,
      });

      expect(traceFoldReadAnchorMs(event, NOW)).toBe(SPAN_START_MS);
    });

    it("keeps occurredAt for an event that is not a span", () => {
      expect(
        traceFoldReadAnchorMs({ type: "lw.obs.trace.origin_resolved", occurredAt: NOW }, NOW),
      ).toBe(NOW);
    });
  });

  describe("given a span whose start time is unusable", () => {
    it("falls back to the event's occurredAt", () => {
      const event = createSpanReceivedEvent({ occurredAt: NOW, startTimeUnixNano: "0" });

      expect(traceFoldReadAnchorMs(event, NOW)).toBe(NOW);
    });

    it("ignores a start time more than a day in the future", () => {
      const event = createSpanReceivedEvent({
        occurredAt: NOW,
        startTimeUnixNano: `${NOW + 2 * DAY_MS}000000`,
      });

      expect(traceFoldReadAnchorMs(event, NOW)).toBe(NOW);
    });
  });
});
