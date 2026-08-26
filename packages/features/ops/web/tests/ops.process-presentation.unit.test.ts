import { describe, expect, it } from "vitest";
import { describeNextWake, hasFleetTrouble } from "../src/ops.process-presentation";

const NOW = 1_755_100_000_000;

describe("describeNextWake", () => {
  describe("given an instance whose next wake is long past due", () => {
    /** @scenario "Overdue wakes are surfaced with their age" */
    it("reads as due with how long ago, never as a bare countdown", () => {
      expect(describeNextWake(NOW - 3 * 60 * 1000, NOW)).toBe("due 3m ago");
    });
  });

  it("reads a future wake as a countdown", () => {
    expect(describeNextWake(NOW + 4 * 60 * 1000, NOW)).toBe("in 4m");
  });

  it("says none when no wake is scheduled", () => {
    expect(describeNextWake(null, NOW)).toBe("none");
  });
});

describe("hasFleetTrouble", () => {
  const healthy = {
    processName: "p",
    pipelineName: "pl",
    scheduled: false,
    instances: 10,
    overdueWakes: 0,
    pendingMessages: 5,
    overduePending: 0,
    lapsedLeases: 0,
    deadMessages: 0,
  };

  it("does not read ordinary pending work as trouble", () => {
    expect(hasFleetTrouble(healthy)).toBe(false);
  });

  it("reads each trouble class as trouble", () => {
    expect(hasFleetTrouble({ ...healthy, deadMessages: 1 })).toBe(true);
    expect(hasFleetTrouble({ ...healthy, lapsedLeases: 1 })).toBe(true);
    expect(hasFleetTrouble({ ...healthy, overduePending: 1 })).toBe(true);
    expect(hasFleetTrouble({ ...healthy, overdueWakes: 1 })).toBe(true);
  });
});
