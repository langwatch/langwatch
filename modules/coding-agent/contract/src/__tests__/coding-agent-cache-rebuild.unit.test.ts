import { describe, expect, it } from "vitest";

import { isCacheRebuild } from "../index.ts";

describe("isCacheRebuild", () => {
  describe("when the call read everything the previous call cached and wrote a large file on top", () => {
    /** @scenario "New content written on top of a full cache read is growth, not a rebuild" */
    it("is not a rebuild", () => {
      expect(
        isCacheRebuild({
          previousContextTokens: 14_817,
          previousCachedTokens: 14_814,
          cacheReadTokens: 14_814,
          cacheCreationTokens: 80_016,
        }),
      ).toBe(false);
    });
  });

  describe("when the call read none of the previous call's cache and wrote it again", () => {
    /** @scenario "A call whose cache read fell and that wrote the context again is a rebuild" */
    it("is a rebuild", () => {
      expect(
        isCacheRebuild({
          previousContextTokens: 100_000,
          previousCachedTokens: 100_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 90_000,
        }),
      ).toBe(true);
    });
  });

  describe("when the read fell by less than half of what was cached", () => {
    it("is not a rebuild", () => {
      expect(
        isCacheRebuild({
          previousContextTokens: 100_000,
          previousCachedTokens: 100_000,
          cacheReadTokens: 60_000,
          cacheCreationTokens: 90_000,
        }),
      ).toBe(false);
    });
  });

  describe("when the previous call cached nothing", () => {
    it("is not a rebuild, since there was nothing to reuse", () => {
      expect(
        isCacheRebuild({
          previousContextTokens: 80_000,
          previousCachedTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 80_000,
        }),
      ).toBe(false);
    });
  });

  describe("when the read fell but little was written again", () => {
    it("is not a rebuild, since the context shrank rather than being re-sent", () => {
      expect(
        isCacheRebuild({
          previousContextTokens: 100_000,
          previousCachedTokens: 100_000,
          cacheReadTokens: 0,
          cacheCreationTokens: 20_000,
        }),
      ).toBe(false);
    });
  });

  describe("when the write is under the token floor", () => {
    it("is not a rebuild", () => {
      expect(
        isCacheRebuild({
          previousContextTokens: 500,
          previousCachedTokens: 500,
          cacheReadTokens: 0,
          cacheCreationTokens: 400,
        }),
      ).toBe(false);
    });
  });
});
