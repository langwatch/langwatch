/**
 * @vitest-environment node
 * The key a browser seals its mirrored reads under, derived per user and per epoch.
 * @see specs/ui/browser-query-caching.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  QUERY_CACHE_EPOCH_MS,
  queryCacheEpochOf,
  queryCacheKeyDeriver,
} from "../query-cache-key.rules.ts";

const derive = queryCacheKeyDeriver({ secret: "a-deployment-session-secret" });
const alice = { userId: "user-1", impersonatorId: undefined, epoch: 2900 };

describe("queryCacheKeyDeriver", () => {
  describe("given one user, generation and epoch", () => {
    /** @scenario "The same user always gets the same cache key" */
    it("derives the same 256-bit key every time", () => {
      const first = derive(alice);

      expect(derive({ ...alice })).toBe(first);
      expect(Buffer.from(first, "base64")).toHaveLength(32);
    });
  });

  describe("given two users, or a user and someone browsing as them", () => {
    /** @scenario "Two users get different cache keys" */
    it("derives different keys", () => {
      const own = derive(alice);

      expect(derive({ ...alice, userId: "user-2" })).not.toBe(own);
      expect(derive({ ...alice, impersonatorId: "admin-1" })).not.toBe(own);
    });
  });

  describe("given the epoch moved on", () => {
    /** @scenario "A key expires with its epoch" */
    it("derives a different key for the same user", () => {
      expect(derive({ ...alice, epoch: alice.epoch - 1 })).not.toBe(derive(alice));
    });
  });

  describe("given another deployment's secret", () => {
    it("derives a different key for the same user", () => {
      const elsewhere = queryCacheKeyDeriver({ secret: "another-secret" });

      expect(elsewhere(alice)).not.toBe(derive(alice));
    });
  });

  describe("given no session secret", () => {
    it("refuses rather than derive from nothing", () => {
      const unkeyed = queryCacheKeyDeriver({ secret: undefined });

      expect(() => unkeyed(alice)).toThrow(
        "cannot derive a query-cache key: this deployment named no session secret",
      );
    });
  });
});

describe("queryCacheEpochOf", () => {
  describe("given two instants inside one seven-day epoch", () => {
    it("names the same epoch, and the next one after it", () => {
      const start = Temporal.Instant.fromEpochMilliseconds(2900 * QUERY_CACHE_EPOCH_MS);
      const end = Temporal.Instant.fromEpochMilliseconds(2901 * QUERY_CACHE_EPOCH_MS - 1);

      expect(queryCacheEpochOf({ at: start })).toBe(2900);
      expect(queryCacheEpochOf({ at: end })).toBe(2900);
      expect(queryCacheEpochOf({ at: end.add({ milliseconds: 1 }) })).toBe(2901);
    });
  });
});
