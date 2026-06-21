import { describe, expect, it } from "vitest";

import { hasRedisHashTag } from "../redisHashTag";

describe("hasRedisHashTag", () => {
  describe("given a name with a non-empty hash tag", () => {
    it("returns true", () => {
      expect(hasRedisHashTag("{tenant/queue}")).toBe(true);
      expect(hasRedisHashTag("prefix{tag}suffix")).toBe(true);
      expect(hasRedisHashTag("{a}")).toBe(true);
    });
  });

  describe("given a name without any hash tag", () => {
    it("returns false", () => {
      expect(hasRedisHashTag("no-tag-here")).toBe(false);
      expect(hasRedisHashTag("open{butneverclosed")).toBe(false);
    });
  });

  describe("given a name with an empty hash tag", () => {
    it("returns false — Redis ignores {} and hashes the whole key", () => {
      expect(hasRedisHashTag("empty{}tag")).toBe(false);
    });
  });
});
