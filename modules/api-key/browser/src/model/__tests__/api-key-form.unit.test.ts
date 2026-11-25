import { describe, expect, it } from "vitest";

import {
  EXPIRATION_NEVER,
  EXPIRATION_UNCHOSEN,
  isExpirationChosen,
  resolveExpiresAt,
} from "../api-key-form.ts";

describe("isExpirationChosen", () => {
  describe("when nothing has been chosen", () => {
    it("is false", () => {
      expect(isExpirationChosen({ preset: EXPIRATION_UNCHOSEN, customDate: "" })).toBe(false);
    });
  });

  describe("when No expiration is chosen", () => {
    it("is true", () => {
      expect(isExpirationChosen({ preset: EXPIRATION_NEVER, customDate: "" })).toBe(true);
    });
  });

  describe("when a preset is chosen", () => {
    it("is true", () => {
      expect(isExpirationChosen({ preset: "30", customDate: "" })).toBe(true);
    });
  });

  describe("when custom is chosen", () => {
    it("is true only once a date is named", () => {
      expect(isExpirationChosen({ preset: "custom", customDate: "" })).toBe(false);
      expect(isExpirationChosen({ preset: "custom", customDate: "2030-01-01" })).toBe(true);
    });
  });
});

describe("resolveExpiresAt", () => {
  describe("when No expiration is chosen", () => {
    it("resolves to no expiry", () => {
      expect(resolveExpiresAt({ preset: EXPIRATION_NEVER, customDate: "" })).toBeUndefined();
    });
  });

  describe("when a preset is chosen", () => {
    it("resolves to that many days from now", () => {
      const now = 1_000_000;
      const resolved = resolveExpiresAt({ preset: "7", customDate: "", now });
      expect(resolved?.epochMilliseconds).toBe(now + 7 * 24 * 60 * 60 * 1000);
    });
  });
});
