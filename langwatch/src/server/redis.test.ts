import { describe, expect, it } from "vitest";
import { parseRedisDbIndex } from "./redis";

describe("parseRedisDbIndex", () => {
  describe("when unset", () => {
    it("returns 0", () => {
      expect(parseRedisDbIndex(undefined)).toBe(0);
      expect(parseRedisDbIndex("")).toBe(0);
    });
  });

  describe("when set to a valid index", () => {
    it("returns the parsed number", () => {
      expect(parseRedisDbIndex("0")).toBe(0);
      expect(parseRedisDbIndex("1")).toBe(1);
      expect(parseRedisDbIndex("15")).toBe(15);
    });
  });

  describe("when set to something invalid", () => {
    it("falls back to 0 rather than throwing — redis.ts must never block startup over this dev affordance", () => {
      expect(parseRedisDbIndex("banana")).toBe(0);
      expect(parseRedisDbIndex("-1")).toBe(0);
      expect(parseRedisDbIndex("16")).toBe(0);
      expect(parseRedisDbIndex("9999")).toBe(0);
    });
  });
});
