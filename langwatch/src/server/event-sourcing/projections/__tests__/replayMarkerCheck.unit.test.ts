import { describe, it, expect, vi } from "vitest";
import {
  RedisReplayMarkerChecker,
  ReplayDeferralError,
} from "../replayMarkerCheck";
import { isAtOrBeforeCutoff, isAtOrBeforeCutoffMarker } from "../../replay/replayConstants";
import type { Event } from "../../domain/types";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "evt-001",
    aggregateId: "agg-1",
    aggregateType: "trace",
    tenantId: "tenant-1" as any,
    createdAt: 1700000000000,
    occurredAt: 1700000000000,
    type: "trace.upserted",
    version: "2025-01-01",
    data: {},
    ...overrides,
  } as Event;
}

describe("isAtOrBeforeCutoff", () => {
  it("returns true when event timestamp is before cutoff", () => {
    expect(isAtOrBeforeCutoff(1000, "evt-001", 2000, "evt-999")).toBe(true);
  });

  it("returns false when event timestamp is after cutoff", () => {
    expect(isAtOrBeforeCutoff(3000, "evt-001", 2000, "evt-999")).toBe(false);
  });

  describe("when timestamps are equal", () => {
    it("returns true when eventId is before cutoffEventId", () => {
      expect(isAtOrBeforeCutoff(1000, "evt-001", 1000, "evt-002")).toBe(true);
    });

    it("returns true when eventId equals cutoffEventId", () => {
      expect(isAtOrBeforeCutoff(1000, "evt-002", 1000, "evt-002")).toBe(true);
    });

    it("returns false when eventId is after cutoffEventId", () => {
      expect(isAtOrBeforeCutoff(1000, "evt-003", 1000, "evt-002")).toBe(false);
    });
  });
});

describe("isAtOrBeforeCutoffMarker", () => {
  it("parses marker format and compares correctly", () => {
    expect(isAtOrBeforeCutoffMarker(1000, "evt-001", "2000:evt-999")).toBe(true);
    expect(isAtOrBeforeCutoffMarker(3000, "evt-001", "2000:evt-999")).toBe(false);
  });

  it("returns false for malformed markers (no colon)", () => {
    expect(isAtOrBeforeCutoffMarker(1000, "evt-001", "invalid")).toBe(false);
  });

  it("handles marker with eventId containing colons", () => {
    // eventId could theoretically contain colons — only first colon separates timestamp
    expect(isAtOrBeforeCutoffMarker(1000, "evt:001", "2000:evt:002")).toBe(true);
  });
});

describe("RedisReplayMarkerChecker", () => {
  function createChecker() {
    const hget = vi.fn<[string, string], Promise<string | null>>();
    const redis = { hget };
    const checker = new RedisReplayMarkerChecker(redis);
    return { checker, hget };
  }

  describe("when no marker exists", () => {
    it("allows the event through (resolves)", async () => {
      const { checker, hget } = createChecker();
      hget.mockResolvedValue(null);

      await expect(checker.check("traceSummary", makeEvent())).resolves.toBeUndefined();
      expect(hget).toHaveBeenCalledWith(
        "projection-replay:cutoff:traceSummary",
        "tenant-1:trace:agg-1",
      );
    });
  });

  describe("when marker is 'pending'", () => {
    it("throws ReplayDeferralError", async () => {
      const { checker, hget } = createChecker();
      hget.mockResolvedValue("pending");

      await expect(checker.check("traceSummary", makeEvent())).rejects.toThrow(ReplayDeferralError);
      await expect(checker.check("traceSummary", makeEvent())).rejects.toThrow("cutoff being recorded");
    });
  });

  describe("when event is at or before cutoff", () => {
    it("allows the event through (replay handles it)", async () => {
      const { checker, hget } = createChecker();
      // Cutoff: timestamp 1700000001000, eventId evt-010
      // Event:  timestamp 1700000000000, eventId evt-001 → before cutoff
      hget.mockResolvedValue("1700000001000:evt-010");

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000000000, id: "evt-001" })),
      ).resolves.toBeUndefined();
    });
  });

  describe("when event is after cutoff", () => {
    it("throws ReplayDeferralError", async () => {
      const { checker, hget } = createChecker();
      // Cutoff: timestamp 1700000000000, eventId evt-001
      // Event:  timestamp 1700000002000, eventId evt-999 → after cutoff
      hget.mockResolvedValue("1700000000000:evt-001");

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000002000, id: "evt-999" })),
      ).rejects.toThrow(ReplayDeferralError);
      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000002000, id: "evt-999" })),
      ).rejects.toThrow("deferring event past cutoff");
    });
  });

  describe("when event has same timestamp but later eventId", () => {
    it("throws ReplayDeferralError", async () => {
      const { checker, hget } = createChecker();
      hget.mockResolvedValue("1700000000000:evt-001");

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000000000, id: "evt-002" })),
      ).rejects.toThrow(ReplayDeferralError);
    });
  });

  describe("when event has same timestamp and same eventId", () => {
    it("allows the event through (at cutoff boundary)", async () => {
      const { checker, hget } = createChecker();
      hget.mockResolvedValue("1700000000000:evt-001");

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000000000, id: "evt-001" })),
      ).resolves.toBeUndefined();
    });
  });

  it("constructs the correct aggregate key from event fields", async () => {
    const { checker, hget } = createChecker();
    hget.mockResolvedValue(null);

    await checker.check(
      "evalRun",
      makeEvent({ tenantId: "proj_abc" as any, aggregateType: "evaluation", aggregateId: "eval-42" }),
    );

    expect(hget).toHaveBeenCalledWith(
      "projection-replay:cutoff:evalRun",
      "proj_abc:evaluation:eval-42",
    );
  });
});
