/**
 * The latch an owner reads its id-index flag through: no lookup waits on the flag.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { describe, expect, it } from "vitest";

import { FeatureFlagLatch } from "../feature-flag-latch.ts";
import { idIndexFlagKey, pickFlagDefinition } from "../feature-flag.ts";

const SHARED = idIndexFlagKey({ owner: "trace", target: "shared" });
const PRIVATE = idIndexFlagKey({ owner: "trace", target: "org_private" });

/** A flag store that answers only when the test releases it. */
function storeWith(values: Record<string, boolean>) {
  const pending: (() => void)[] = [];
  const reads: string[] = [];
  return {
    reads,
    isEnabled: (key: string) =>
      new Promise<boolean>((resolve) => {
        reads.push(key);
        pending.push(() => resolve(values[key] ?? false));
      }),
    release: async () => {
      for (const answer of pending.splice(0)) answer();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

describe("FeatureFlagLatch", () => {
  describe("given the owner's id index flag is on for one target and off for another", () => {
    /** @scenario "readers trust the index only once its flag is on" */
    it("answers false at once, then each target's own value, without awaiting the store", async () => {
      const store = storeWith({ [SHARED]: true, [PRIVATE]: false });
      const latch = new FeatureFlagLatch({ isEnabled: store.isEnabled });

      expect(latch.isOn(SHARED)).toBe(false);
      expect(latch.isOn(PRIVATE)).toBe(false);
      await store.release();

      expect(latch.isOn(SHARED)).toBe(true);
      expect(latch.isOn(PRIVATE)).toBe(false);
    });
  });

  describe("when an answer is older than the refresh interval", () => {
    it("keeps answering it while one background read refreshes it", async () => {
      let now = 0;
      const values: Record<string, boolean> = { [SHARED]: true };
      const store = storeWith(values);
      const latch = new FeatureFlagLatch({
        isEnabled: store.isEnabled,
        refreshMs: 60_000,
        now: () => now,
      });
      latch.isOn(SHARED);
      await store.release();

      values[SHARED] = false;
      now = 61_000;
      expect(latch.isOn(SHARED)).toBe(true);
      expect(latch.isOn(SHARED)).toBe(true);
      expect(store.reads).toHaveLength(2);
      await store.release();

      expect(latch.isOn(SHARED)).toBe(false);
    });
  });

  describe("when the store fails", () => {
    it("keeps the last answer and reads again on the next call", async () => {
      let fail = false;
      let calls = 0;
      const latch = new FeatureFlagLatch({
        isEnabled: async () => {
          calls += 1;
          if (fail) throw new Error("store down");
          return true;
        },
        refreshMs: 0,
      });
      latch.isOn(SHARED);
      await Promise.resolve();
      await Promise.resolve();
      fail = true;

      expect(latch.isOn(SHARED)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(latch.isOn(SHARED)).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(2);
    });
  });

  describe("when an id index flag key is resolved", () => {
    it("resolves every owner and target key as a SYSTEM flag, off by default", () => {
      expect(idIndexFlagKey({ owner: "coding-agent", target: "shared" })).toBe(
        "clickhouse_id_index_coding_agent_shared",
      );
      expect(pickFlagDefinition(PRIVATE)).toMatchObject({ scope: "SYSTEM", defaultValue: false });
    });
  });
});
