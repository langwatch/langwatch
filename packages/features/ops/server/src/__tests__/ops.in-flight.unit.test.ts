import { describe, expect, it } from "vitest";
import { type InFlightCounts, totalInFlight } from "../ops.in-flight";

function queue(overrides: Partial<InFlightCounts> = {}): InFlightCounts {
  return {
    totalPendingJobs: 0,
    activeGroupCount: 0,
    parkedGroupCount: 0,
    ...overrides,
  };
}

describe("given a queue with work in several states", () => {
  describe("when the dashboard totals what is in flight", () => {
    /** @scenario "Parked work counts as in flight" */
    it("counts parked groups alongside pending and active", () => {
      const total = totalInFlight({
        queues: [
          queue({
            totalPendingJobs: 100,
            activeGroupCount: 10,
            parkedGroupCount: 500,
          }),
        ],
      });

      expect(total).toBe(610);
    });

    /** @scenario "Parked work counts as in flight" */
    it("sums across every queue", () => {
      const total = totalInFlight({
        queues: [
          queue({ totalPendingJobs: 5, parkedGroupCount: 1 }),
          queue({ activeGroupCount: 2, parkedGroupCount: 3 }),
        ],
      });

      expect(total).toBe(11);
    });

    it("is zero for an idle fleet", () => {
      expect(totalInFlight({ queues: [queue(), queue()] })).toBe(0);
    });
  });

  /**
   * The regression this module exists for. `Staged/s` is derived as the
   * change in in-flight work plus completions, so work moving from pending
   * into parked must leave the total unchanged. When parking was excluded,
   * the same movement looked like 500 jobs leaving the system and the
   * derived ingestion rate lost exactly that much.
   */
  describe("when a tenant's groups park", () => {
    /** @scenario "Parked work counts as in flight" */
    it("does not change the total when work moves from pending to parked", () => {
      const before = totalInFlight({
        queues: [queue({ totalPendingJobs: 900, parkedGroupCount: 0 })],
      });
      const after = totalInFlight({
        queues: [queue({ totalPendingJobs: 400, parkedGroupCount: 500 })],
      });

      expect(after).toBe(before);
    });
  });
});
