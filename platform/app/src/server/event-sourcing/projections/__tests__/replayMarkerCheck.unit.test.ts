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
  // The checker reads the active cutoff marker (cutoff hash) and the terminal
  // short-TTL "done" marker (separate key) in one pipeline. Mock that pipeline
  // and let each test set the two returned values independently.
  function createChecker() {
    const markers = { cutoff: null as string | null, done: null as string | null };
    const hget = vi.fn<(key: string, field: string) => void>();
    const get = vi.fn<(key: string) => void>();
    const exec = vi.fn(async () => [
      [null, markers.cutoff] as [Error | null, unknown],
      [null, markers.done] as [Error | null, unknown],
    ]);
    const pipelineObj = {
      hget: (key: string, field: string) => {
        hget(key, field);
        return pipelineObj;
      },
      get: (key: string) => {
        get(key);
        return pipelineObj;
      },
      exec,
    };
    const redis = { pipeline: () => pipelineObj };
    const checker = new RedisReplayMarkerChecker(redis);
    const setMarkers = (opts: { cutoff?: string | null; done?: string | null }) => {
      markers.cutoff = opts.cutoff ?? null;
      markers.done = opts.done ?? null;
    };
    return { checker, hget, get, setMarkers };
  }

  describe("when no marker exists", () => {
    it("returns 'process'", async () => {
      const { checker, hget, get } = createChecker();

      await expect(checker.check("traceSummary", makeEvent())).resolves.toBe("process");
      expect(hget).toHaveBeenCalledWith(
        "projection-replay:cutoff:traceSummary",
        "tenant-1:trace:agg-1",
      );
      expect(get).toHaveBeenCalledWith(
        "projection-replay:done:traceSummary:tenant-1:trace:agg-1",
      );
    });
  });

  describe("when marker is 'pending'", () => {
    it("throws ReplayDeferralError", async () => {
      const { checker, setMarkers } = createChecker();
      setMarkers({ cutoff: "pending" });

      await expect(checker.check("traceSummary", makeEvent())).rejects.toThrow(ReplayDeferralError);
      await expect(checker.check("traceSummary", makeEvent())).rejects.toThrow("cutoff being recorded");
    });
  });

  describe("when event is at or before cutoff", () => {
    it("returns 'skip' (replay handles it)", async () => {
      const { checker, setMarkers } = createChecker();
      // Cutoff: timestamp 1700000001000, eventId evt-010
      // Event:  timestamp 1700000000000, eventId evt-001 → before cutoff
      setMarkers({ cutoff: "1700000001000:evt-010" });

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000000000, id: "evt-001" })),
      ).resolves.toBe("skip");
    });
  });

  describe("when event is after cutoff", () => {
    it("throws ReplayDeferralError", async () => {
      const { checker, setMarkers } = createChecker();
      // Cutoff: timestamp 1700000000000, eventId evt-001
      // Event:  timestamp 1700000002000, eventId evt-999 → after cutoff
      setMarkers({ cutoff: "1700000000000:evt-001" });

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
      const { checker, setMarkers } = createChecker();
      setMarkers({ cutoff: "1700000000000:evt-001" });

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000000000, id: "evt-002" })),
      ).rejects.toThrow(ReplayDeferralError);
    });
  });

  describe("when event has same timestamp and same eventId", () => {
    it("returns 'skip' (at cutoff boundary)", async () => {
      const { checker, setMarkers } = createChecker();
      setMarkers({ cutoff: "1700000000000:evt-001" });

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000000000, id: "evt-001" })),
      ).resolves.toBe("skip");
    });
  });

  // Terminal "done" marker: replay has finished rebuilding this aggregate. The
  // boundary must still skip events at/before the cutoff (a job staged but never
  // active during the pause must not re-run and double-write) while letting
  // genuinely newer events process live.
  describe("when a done marker exists (replay finished) and no active cutoff", () => {
    describe("and the event is at or before the cutoff", () => {
      it("returns 'skip' so a staged late job does not double-write", async () => {
        const { checker, setMarkers } = createChecker();
        setMarkers({ cutoff: null, done: "1700000001000:evt-010" });

        await expect(
          checker.check("traceSummary", makeEvent({ createdAt: 1700000000000, id: "evt-001" })),
        ).resolves.toBe("skip");
      });
    });

    describe("and the event is after the cutoff", () => {
      it("returns 'process' so genuinely newer events are not deferred forever", async () => {
        const { checker, setMarkers } = createChecker();
        setMarkers({ cutoff: null, done: "1700000000000:evt-001" });

        await expect(
          checker.check("traceSummary", makeEvent({ createdAt: 1700000002000, id: "evt-999" })),
        ).resolves.toBe("process");
      });
    });
  });

  describe("when both an active cutoff and a done marker exist", () => {
    it("the active cutoff takes precedence (a new replay is in flight)", async () => {
      const { checker, setMarkers } = createChecker();
      // Active replay defers a post-cutoff event even though a stale done marker
      // from a prior run would have processed it.
      setMarkers({ cutoff: "1700000000000:evt-001", done: "1600000000000:evt-000" });

      await expect(
        checker.check("traceSummary", makeEvent({ createdAt: 1700000002000, id: "evt-999" })),
      ).rejects.toThrow(ReplayDeferralError);
    });
  });

  it("constructs the correct aggregate key from event fields", async () => {
    const { checker, hget, get } = createChecker();

    await checker.check(
      "evalRun",
      makeEvent({ tenantId: "proj_abc" as any, aggregateType: "evaluation", aggregateId: "eval-42" }),
    );

    expect(hget).toHaveBeenCalledWith(
      "projection-replay:cutoff:evalRun",
      "proj_abc:evaluation:eval-42",
    );
    expect(get).toHaveBeenCalledWith(
      "projection-replay:done:evalRun:proj_abc:evaluation:eval-42",
    );
  });
});
