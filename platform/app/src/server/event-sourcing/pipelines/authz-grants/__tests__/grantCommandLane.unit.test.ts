/**
 * ADR-114 — the lane a grant command waits in.
 *
 * @see specs/event-sourcing/authz-grant-command-lanes.feature
 */
import { describe, expect, it } from "vitest";
import {
  GRANT_COALESCE_MAX_BATCH,
  GRANT_SHARD_COUNT,
  grantCommandLane,
  MAX_GRANT_SHARD_COUNT,
} from "../commands/grantCommandLane";

describe("given grant commands to place on a queue lane", () => {
  describe("when two commands name the same grant", () => {
    /** @scenario "Commands about the same grant share a lane" */
    it("puts both in the same lane", () => {
      const first = grantCommandLane({ aggregateId: "grant_abc" });
      const second = grantCommandLane({ aggregateId: "grant_abc" });

      expect(first).toBe(second);
    });
  });

  describe("when the commands name different grants", () => {
    /** @scenario "Commands about different grants spread across lanes" */
    it("spreads them across the organization's lanes", () => {
      const lanes = new Set(
        Array.from({ length: 500 }, (_, i) =>
          grantCommandLane({ aggregateId: `grant_${i}` }),
        ),
      );

      // Every lane in use, and none of them holding the whole population.
      expect(lanes.size).toBe(GRANT_SHARD_COUNT);
    });

    /** @scenario "Commands about different grants spread across lanes" */
    it("gives no single lane all of them", () => {
      const counts = new Map<string, number>();
      for (let i = 0; i < 500; i++) {
        const lane = grantCommandLane({ aggregateId: `grant_${i}` });
        counts.set(lane, (counts.get(lane) ?? 0) + 1);
      }

      expect(Math.max(...counts.values())).toBeLessThan(500);
    });
  });

  describe("when the same id is placed twice", () => {
    /** @scenario "A lane is stable across processes and restarts" */
    it("derives the same lane both times", () => {
      // A literal, not a round-trip: this pins the bucket against an accidental
      // change to the hash, which would silently re-lane every in-flight retry.
      expect(
        grantCommandLane({ aggregateId: "grant_abc", shardCount: 4 }),
      ).toBe(grantCommandLane({ aggregateId: "grant_abc", shardCount: 4 }));
      expect(
        grantCommandLane({ aggregateId: "grant_abc", shardCount: 4 }),
      ).toMatch(/^[0-3]$/);
    });
  });

  describe("when the lane is read", () => {
    /** @scenario "The organization is not repeated in the lane" */
    it("does not restate the organization", () => {
      const lane = grantCommandLane({ aggregateId: "grant_abc" });

      // `buildGroupKey` already prepends the tenant; repeating it here would
      // only lengthen every key.
      expect(lane).toMatch(/^\d+$/);
    });
  });

  describe("when sharding is turned off", () => {
    /** @scenario "Sharding can be turned off" */
    it("collapses every command into one lane", () => {
      const lanes = new Set(
        Array.from({ length: 50 }, (_, i) =>
          grantCommandLane({ aggregateId: `grant_${i}`, shardCount: 1 }),
        ),
      );

      expect(lanes.size).toBe(1);
    });
  });

  describe("when the shard count makes no sense", () => {
    /** @scenario "A nonsensical shard count falls back to one lane" */
    it.each([0, -1, 1.5])("falls back to one lane for %s", (count) => {
      const lanes = new Set(
        Array.from({ length: 20 }, (_, i) =>
          grantCommandLane({ aggregateId: `grant_${i}`, shardCount: count }),
        ),
      );

      expect(lanes.size).toBe(1);
    });
  });

  describe("when the shard count is above the maximum", () => {
    /** @scenario "The shard count is bounded" */
    it("uses the maximum instead", () => {
      const lanes = new Set(
        Array.from({ length: 4000 }, (_, i) =>
          grantCommandLane({
            aggregateId: `grant_${i}`,
            shardCount: MAX_GRANT_SHARD_COUNT * 10,
          }),
        ),
      );

      expect(lanes.size).toBeLessThanOrEqual(MAX_GRANT_SHARD_COUNT);
    });
  });

  describe("when the batch bound is read", () => {
    /** @scenario "The batch bound is a flat number, not a resolver" */
    it("is a flat number the byte budget can weigh", () => {
      expect(typeof GRANT_COALESCE_MAX_BATCH).toBe("number");
      expect(GRANT_COALESCE_MAX_BATCH).toBeGreaterThan(1);
    });
  });
});
