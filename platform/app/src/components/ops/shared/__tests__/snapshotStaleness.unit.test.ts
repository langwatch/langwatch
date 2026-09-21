import { describe, expect, it } from "vitest";
import { isSnapshotStale, SNAPSHOT_STALE_AFTER_MS } from "../snapshotStaleness";

const NOW = new Date("2026-08-13T12:00:00.000Z").getTime();

describe("isSnapshotStale", () => {
  describe("given numbers nobody has refreshed past the threshold", () => {
    /** @scenario "A stale snapshot is visible to the operator, not just present in the payload" */
    it("reports them stale, so the page can say how old they are", () => {
      expect(
        isSnapshotStale({
          computedAtMs: NOW - SNAPSHOT_STALE_AFTER_MS - 1_000,
          now: NOW,
        }),
      ).toBe(true);
    });

    /** @scenario "A healthy connection does not vouch for stale numbers" */
    it("does not consult the connection at all", () => {
      // The connection is between the browser and its OWN pod, and every pod
      // keeps serving the last snapshot it read. A green socket over a dead
      // writer is precisely the case where the light misleads, so staleness is
      // decided without reference to it.
      expect(
        isSnapshotStale({
          computedAtMs: NOW - SNAPSHOT_STALE_AFTER_MS - 45_000,
          now: NOW,
        }),
      ).toBe(true);
    });
  });

  describe("given a snapshot refreshed within the threshold", () => {
    it("holds it fresh, so an ordinary handover does not flash a warning", () => {
      expect(
        isSnapshotStale({
          computedAtMs: NOW - (SNAPSHOT_STALE_AFTER_MS - 1),
          now: NOW,
        }),
      ).toBe(false);
    });
  });

  describe("given a snapshot exactly at the threshold", () => {
    it("counts it stale, so the boundary is inclusive", () => {
      expect(
        isSnapshotStale({
          computedAtMs: NOW - SNAPSHOT_STALE_AFTER_MS,
          now: NOW,
        }),
      ).toBe(true);
    });
  });

  describe("given no snapshot has been read at all", () => {
    it("says nothing rather than putting an age on data that does not exist", () => {
      // The page already renders this as its loading state.
      expect(isSnapshotStale({ computedAtMs: null, now: NOW })).toBe(false);
      expect(isSnapshotStale({ computedAtMs: undefined, now: NOW })).toBe(
        false,
      );
    });
  });
});
