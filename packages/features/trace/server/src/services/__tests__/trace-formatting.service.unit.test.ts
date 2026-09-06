import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trace } from "@langwatch/trace-contract";

import { TraceFormattingService } from "../trace-formatting.service.ts";

const NOW = Date.UTC(2026, 5, 15, 12, 0, 0);
const ONE_HOUR_MS = 60 * 60 * 1000;

/** Only the fields the timestamp rendering reads; the rest never leaves the spread. */
const makeTrace = (timestamps: Record<string, unknown>): Trace =>
  ({
    trace_id: "trace-1",
    project_id: "project-1",
    spans: [],
    timestamps,
  }) as unknown as Trace;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TraceFormattingService.toLLMModeTrace", () => {
  describe("when the trace started minutes ago", () => {
    /** @scenario "A time inside the last day reads as an interval" */
    it("reads the start as an interval rather than a date", () => {
      const result = TraceFormattingService.toLLMModeTrace(
        makeTrace({
          started_at: NOW - 12 * 60 * 1000,
          inserted_at: NOW - 11 * 60 * 1000,
          updated_at: NOW - 10 * 60 * 1000,
        }),
      );

      expect(result.timestamps.started_at).toBe("12 minutes ago");
      expect(result.timestamps.inserted_at).toBe("11 minutes ago");
      expect(result.timestamps.updated_at).toBe("10 minutes ago");
    });
  });

  describe("when the trace started just inside the last day", () => {
    /** @scenario "A time inside the last day reads as an interval" */
    it("still reads as an interval at the hour before the cut-off", () => {
      const result = TraceFormattingService.toLLMModeTrace(
        makeTrace({
          started_at: NOW - 23 * ONE_HOUR_MS,
          inserted_at: NOW,
          updated_at: NOW,
        }),
      );

      expect(result.timestamps.started_at).toContain("ago");
      expect(result.timestamps.started_at).not.toMatch(/^\d{2}\//);
    });
  });

  describe("when the trace started more than a day ago", () => {
    /** @scenario "A time older than a day reads as a date" */
    it("reads the start as a day, month and time of day", () => {
      const result = TraceFormattingService.toLLMModeTrace(
        makeTrace({
          started_at: NOW - 3 * 24 * ONE_HOUR_MS,
          inserted_at: NOW,
          updated_at: NOW,
        }),
      );

      expect(result.timestamps.started_at).toMatch(/^\d{2}\/[A-Z][a-z]{2} \d{2}:\d{2}$/);
      expect(result.timestamps.started_at).not.toContain("ago");
      expect(result.timestamps.inserted_at).toContain("ago");
    });
  });

  describe("when a timestamp crossed the wire as an ISO string", () => {
    /** @scenario "A time inside the last day reads as an interval" */
    it("reads it as the same moment the epoch millisecond count names", () => {
      const startedAtMs = NOW - 12 * 60 * 1000;

      const fromString = TraceFormattingService.toLLMModeTrace(
        makeTrace({
          started_at: new Date(startedAtMs).toISOString(),
          inserted_at: new Date(NOW).toISOString(),
          updated_at: new Date(NOW).toISOString(),
        }),
      );
      const fromNumber = TraceFormattingService.toLLMModeTrace(
        makeTrace({ started_at: startedAtMs, inserted_at: NOW, updated_at: NOW }),
      );

      expect(fromString.timestamps).toEqual(fromNumber.timestamps);
      expect(fromString.timestamps.started_at).toBe("12 minutes ago");
    });
  });

  describe("when the trace carries no insert or update time", () => {
    /** @scenario "A missing timestamp reads as nothing rather than as 1970" */
    it("reads them as empty strings rather than as dates at the epoch", () => {
      const result = TraceFormattingService.toLLMModeTrace(
        makeTrace({ started_at: NOW - 5 * 60 * 1000 }),
      );

      expect(result.timestamps.inserted_at).toBe("");
      expect(result.timestamps.updated_at).toBe("");
      expect(result.timestamps.started_at).toBe("5 minutes ago");
    });
  });

  describe("when a timestamp is the epoch itself", () => {
    /** @scenario "A missing timestamp reads as nothing rather than as 1970" */
    it("reads as nothing rather than as 1 January 1970", () => {
      const result = TraceFormattingService.toLLMModeTrace(
        makeTrace({ started_at: 0, inserted_at: 0, updated_at: 0 }),
      );

      expect(result.timestamps.started_at).toBe("");
      expect(result.timestamps.inserted_at).toBe("");
      expect(result.timestamps.updated_at).toBe("");
    });
  });
});
