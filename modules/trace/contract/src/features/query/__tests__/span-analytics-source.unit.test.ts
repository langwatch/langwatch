/**
 * Which table a window-scale span type read scans, from the span_analytics floor.
 * @see specs/analytics/span-type-light-reads.feature
 */

import { describe, expect, it } from "vitest";

import {
  filtersReadSpanType,
  spanAnalyticsSourceOf,
  UNKNOWN_SPAN_ANALYTICS_FLOOR,
} from "../span-analytics-source.ts";

const FLOOR_ISO = "2026-10-01T00:00:00.000Z";
const FLOOR_MS = Date.parse(FLOOR_ISO);
const FLOOR = { from: FLOOR_ISO, rebuilding: false };

describe("spanAnalyticsSourceOf", () => {
  describe("given a floor that covers the window", () => {
    /** @scenario "A floor that covers the window reads span_analytics alone" */
    it("reads span_analytics alone from the floor's own instant on", () => {
      expect(spanAnalyticsSourceOf({ floor: FLOOR, windowStartMs: FLOOR_MS })).toEqual({
        kind: "span_analytics",
      });
      expect(spanAnalyticsSourceOf({ floor: FLOOR, windowStartMs: FLOOR_MS + 1 })).toEqual({
        kind: "span_analytics",
      });
    });
  });

  describe("given a window that starts before the floor", () => {
    /** @scenario "A window that starts before the floor splits at the floor" */
    it("splits at the floor", () => {
      expect(spanAnalyticsSourceOf({ floor: FLOOR, windowStartMs: FLOOR_MS - 1 })).toEqual({
        kind: "split",
        fromMs: FLOOR_MS,
      });
    });

    /** @scenario "A window that starts before the floor splits at the floor" */
    it("splits a read with no window start too", () => {
      expect(spanAnalyticsSourceOf({ floor: FLOOR })).toEqual({ kind: "split", fromMs: FLOOR_MS });
    });
  });

  describe("given a whole span_analytics history", () => {
    /** @scenario "A whole span_analytics history serves every window" */
    it("reads span_analytics alone for any window or none", () => {
      const whole = { from: null, rebuilding: false };
      expect(spanAnalyticsSourceOf({ floor: whole, windowStartMs: 0 })).toEqual({
        kind: "span_analytics",
      });
      expect(spanAnalyticsSourceOf({ floor: whole })).toEqual({ kind: "span_analytics" });
    });
  });

  describe("given a floor no read may trust", () => {
    /** @scenario "A rebuilding, unknown or unparseable floor keeps stored_spans" */
    it("keeps stored_spans while rebuilding, absent, unknown or unparseable", () => {
      const floors = [
        { from: FLOOR_ISO, rebuilding: true },
        { from: null, rebuilding: true },
        UNKNOWN_SPAN_ANALYTICS_FLOOR,
        { from: "not an instant", rebuilding: false },
        null,
        undefined,
      ];
      for (const floor of floors) {
        expect(spanAnalyticsSourceOf({ floor, windowStartMs: FLOOR_MS + 1 })).toEqual({
          kind: "stored_spans",
        });
      }
    });
  });
});

describe("filtersReadSpanType", () => {
  describe("given a filters document", () => {
    /** @scenario "Only reads that name a span type look up the floor" */
    it("is true only for a span type filter with something selected", () => {
      expect(filtersReadSpanType({ "spans.type": ["llm"] })).toBe(true);
      expect(filtersReadSpanType({ "spans.type": { any: ["llm"] } })).toBe(true);
      expect(filtersReadSpanType({ "spans.type": [] })).toBe(false);
      expect(filtersReadSpanType({ "spans.model": ["gpt-5"] })).toBe(false);
      expect(filtersReadSpanType(undefined)).toBe(false);
    });
  });
});
