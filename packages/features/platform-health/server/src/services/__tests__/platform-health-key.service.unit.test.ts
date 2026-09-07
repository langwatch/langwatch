import { describe, expect, it } from "vitest";

import { PlatformHealthKeyService } from "../platform-health-key.service.ts";

describe("given a deployment that configured a platform health key", () => {
  const keys = PlatformHealthKeyService.create({ apiKey: "monitoring-key" });

  describe("when the configured key is presented", () => {
    it("accepts it", () => {
      expect(keys.accepts("monitoring-key")).toBe(true);
    });
  });

  describe("when a key of a different length is presented", () => {
    /** @scenario "A key of a different length is refused without a byte-by-byte comparison" */
    it("refuses it before any byte comparison", () => {
      expect(keys.accepts("monitoring-key-that-is-longer")).toBe(false);
      expect(keys.accepts("short")).toBe(false);
      expect(keys.accepts("")).toBe(false);
      expect(keys.accepts(null)).toBe(false);
    });
  });

  describe("when a key of the same length but different bytes is presented", () => {
    it("refuses it", () => {
      expect(keys.accepts("monitoring-kez")).toBe(false);
    });
  });
});

describe("given a deployment that configured no key", () => {
  describe("when any key is presented", () => {
    it("accepts nothing, so a blank configuration cannot open the door", () => {
      const keys = PlatformHealthKeyService.create({ apiKey: "" });
      expect(keys.accepts("")).toBe(false);
      expect(keys.accepts("anything")).toBe(false);
    });
  });
});
