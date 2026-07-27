import { describe, expect, it } from "vitest";

import {
  isSweepConfirmed,
  multipleOfBaseline,
  orderGroups,
  orderQueues,
  orderSchedules,
  queueNeedsAttention,
  redisMemorySeverity,
  scheduleIsStruggling,
  SWEEP_CONFIRMATION,
  sweepOutcomeSeverity,
} from "./ops";

function queue(overrides: Partial<Parameters<typeof orderQueues>[0][number]> = {}) {
  return {
    blockedGroupCount: 0,
    dlqCount: 0,
    totalPendingJobs: 0,
    ...overrides,
  };
}

describe("queueNeedsAttention", () => {
  describe("given a queue with a large backlog but nothing blocked", () => {
    it("does not flag it", () => {
      // A backlog drains on its own. A block does not — that is the difference
      // this flag exists to draw.
      expect(
        queueNeedsAttention({ blockedGroupCount: 0, dlqCount: 0 }),
      ).toBe(false);
    });
  });

  describe("given a queue with blocked groups", () => {
    it("flags it", () => {
      expect(queueNeedsAttention({ blockedGroupCount: 2, dlqCount: 0 })).toBe(true);
    });
  });

  describe("given a queue with dead letters", () => {
    it("flags it", () => {
      expect(queueNeedsAttention({ blockedGroupCount: 0, dlqCount: 1 })).toBe(true);
    });
  });
});

describe("orderQueues", () => {
  describe("given a blocked queue and a busier healthy one", () => {
    it("puts the blocked queue first", () => {
      const healthy = queue({ totalPendingJobs: 100_000 });
      const blocked = queue({ blockedGroupCount: 1, totalPendingJobs: 3 });

      expect(orderQueues([healthy, blocked])).toEqual([blocked, healthy]);
    });
  });

  describe("given two blocked queues", () => {
    it("puts the more blocked one first", () => {
      const fewer = queue({ blockedGroupCount: 1 });
      const more = queue({ blockedGroupCount: 9 });

      expect(orderQueues([fewer, more])).toEqual([more, fewer]);
    });
  });

  describe("given only healthy queues", () => {
    it("falls back to the deepest backlog", () => {
      const small = queue({ totalPendingJobs: 5 });
      const large = queue({ totalPendingJobs: 500 });

      expect(orderQueues([small, large])).toEqual([large, small]);
    });
  });

  it("does not mutate its input", () => {
    const input = [queue({ totalPendingJobs: 1 }), queue({ blockedGroupCount: 1 })];
    const copy = [...input];

    orderQueues(input);

    expect(input).toEqual(copy);
  });
});

describe("orderGroups", () => {
  it("puts blocked groups first, then the deepest backlog", () => {
    const idle = { isBlocked: false, pendingJobs: 90 };
    const blocked = { isBlocked: true, pendingJobs: 1 };
    const busy = { isBlocked: false, pendingJobs: 200 };

    expect(orderGroups([idle, blocked, busy])).toEqual([blocked, busy, idle]);
  });
});

describe("scheduleIsStruggling", () => {
  describe("given a schedule retrying after a failure", () => {
    it("flags it", () => {
      expect(scheduleIsStruggling({ attempts: 3, lastError: "boom" })).toBe(true);
    });
  });

  describe("given a schedule with attempts but no recorded error", () => {
    it("does not flag it", () => {
      expect(scheduleIsStruggling({ attempts: 3, lastError: null })).toBe(false);
    });
  });
});

describe("orderSchedules", () => {
  it("surfaces struggling schedules, then inactive ones, then by next run", () => {
    const healthyLater = {
      attempts: 0,
      lastError: null,
      active: true,
      nextRunAt: "2026-01-02T00:00:00.000Z",
    };
    const healthySooner = {
      attempts: 0,
      lastError: null,
      active: true,
      nextRunAt: "2026-01-01T00:00:00.000Z",
    };
    const inactive = {
      attempts: 0,
      lastError: null,
      active: false,
      nextRunAt: "2025-01-01T00:00:00.000Z",
    };
    const struggling = {
      attempts: 4,
      lastError: "timeout",
      active: true,
      nextRunAt: "2027-01-01T00:00:00.000Z",
    };

    expect(orderSchedules([healthyLater, inactive, healthySooner, struggling])).toEqual(
      [struggling, healthySooner, healthyLater, inactive],
    );
  });
});

describe("multipleOfBaseline", () => {
  it("divides when there is a baseline", () => {
    expect(multipleOfBaseline({ currentRate: 120, baseline: 10 })).toBe(12);
  });

  describe("given a tenant that had no traffic before", () => {
    it("answers null rather than infinity", () => {
      expect(multipleOfBaseline({ currentRate: 50, baseline: 0 })).toBeNull();
    });
  });
});

describe("redisMemorySeverity", () => {
  it("stays normal well below the limit", () => {
    expect(
      redisMemorySeverity({
        redisMemoryUsedBytes: 100,
        redisMemoryMaxBytes: 1000,
      }),
    ).toBe("normal");
  });

  it("warns approaching the limit", () => {
    expect(
      redisMemorySeverity({
        redisMemoryUsedBytes: 800,
        redisMemoryMaxBytes: 1000,
      }),
    ).toBe("warning");
  });

  it("is critical at the limit", () => {
    expect(
      redisMemorySeverity({
        redisMemoryUsedBytes: 950,
        redisMemoryMaxBytes: 1000,
      }),
    ).toBe("critical");
  });

  describe("given an instance with no memory limit set", () => {
    it("stays normal instead of dividing by zero", () => {
      expect(
        redisMemorySeverity({
          redisMemoryUsedBytes: 10_000,
          redisMemoryMaxBytes: 0,
        }),
      ).toBe("normal");
    });
  });
});

describe("sweepOutcomeSeverity", () => {
  it("treats a reclaim as the outcome that destroys bytes", () => {
    expect(sweepOutcomeSeverity("reclaimed")).toBe("critical");
    expect(sweepOutcomeSeverity("repaired")).toBe("warning");
    expect(sweepOutcomeSeverity("leased")).toBe("normal");
  });
});

describe("isSweepConfirmed", () => {
  it("accepts the exact word", () => {
    expect(isSweepConfirmed(SWEEP_CONFIRMATION)).toBe(true);
  });

  describe("given anything other than the exact word", () => {
    it("refuses a partial word", () => {
      expect(isSweepConfirmed("RECLAI")).toBe(false);
    });

    it("refuses the wrong case", () => {
      // Half the value of a typed confirmation is that it cannot be produced by
      // a thumb brushing the screen; a forgiving comparison gives that up.
      expect(isSweepConfirmed("reclaim")).toBe(false);
    });

    it("refuses surrounding whitespace", () => {
      expect(isSweepConfirmed(" RECLAIM ")).toBe(false);
    });

    it("refuses an empty string", () => {
      expect(isSweepConfirmed("")).toBe(false);
    });
  });
});
