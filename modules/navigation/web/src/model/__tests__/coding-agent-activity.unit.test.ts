/**
 * @vitest-environment node
 * @unit
 *
 * The recency rule behind the project's coding-agent destinations.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { describe, expect, it } from "vitest";
import { Temporal } from "@langwatch/time";
import { CODING_AGENT_LINK_WINDOW_DAYS, withinDays } from "../coding-agent-activity.ts";

const NOW = Temporal.Instant.from("2026-08-16T12:00:00.000Z");

const daysBefore = (days: number): number => NOW.epochMilliseconds - days * 24 * 60 * 60 * 1000;

describe("withinDays", () => {
  describe("given a moment inside the window", () => {
    it("reads as recent", () => {
      expect(
        withinDays({
          at: daysBefore(14),
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(true);
    });

    it("accepts the same moment written as a string", () => {
      expect(
        withinDays({
          at: Temporal.Instant.fromEpochMilliseconds(daysBefore(14)).toString({
            fractionalSecondDigits: 3,
          }),
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(true);
    });
  });

  describe("given a moment older than the window", () => {
    it("reads as stale", () => {
      expect(
        withinDays({
          at: daysBefore(16),
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(false);
    });

    // The boundary is the window's own edge, so a value exactly that old is
    // out. Getting this backwards makes the destination flicker for a whole
    // day at the end of the window rather than closing it.
    /** @scenario "The recency window closes at fifteen days" */
    it("reads the exact edge of the window as stale", () => {
      expect(
        withinDays({
          at: daysBefore(CODING_AGENT_LINK_WINDOW_DAYS),
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(false);
    });
  });

  describe("given nothing was ever recorded", () => {
    it("reads null as stale", () => {
      expect(
        withinDays({
          at: null,
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(false);
    });

    it("reads undefined as stale", () => {
      expect(
        withinDays({
          at: undefined,
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(false);
    });

    it("reads an unparseable moment as stale", () => {
      expect(
        withinDays({
          at: "not a date",
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(false);
    });
  });

  describe("given a moment in the future", () => {
    // Clock skew between the worker that recorded it and the browser reading
    // it is the only way to get one, and hiding the destination over a few
    // seconds of skew is a worse answer than showing it.
    it("reads as recent", () => {
      expect(
        withinDays({
          at: NOW.add({ milliseconds: 60_000 }).epochMilliseconds,
          days: CODING_AGENT_LINK_WINDOW_DAYS,
          now: NOW,
        }),
      ).toBe(true);
    });
  });
});
