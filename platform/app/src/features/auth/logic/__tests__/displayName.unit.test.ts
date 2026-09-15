import { describe, expect, it } from "vitest";
import { displayNameFor } from "../displayName";

describe("displayNameFor", () => {
  describe("given somebody who has a name", () => {
    it("calls them by it", () => {
      expect(displayNameFor({ name: "Sam Patel", email: "sam@acme.com" })).toBe(
        "Sam Patel",
      );
    });
  });

  describe("given an account that never got a name", () => {
    it("falls back to the address rather than rendering the gap", () => {
      expect(displayNameFor({ name: null, email: "sam@acme.com" })).toBe(
        "sam@acme.com",
      );
      expect(displayNameFor({ email: "sam@acme.com" })).toBe("sam@acme.com");
    });

    it("reads a name that is only whitespace as no name", () => {
      expect(displayNameFor({ name: "   ", email: "sam@acme.com" })).toBe(
        "sam@acme.com",
      );
    });
  });

  describe("given neither a name nor an address", () => {
    it("renders nothing at all, never a placeholder word", () => {
      expect(displayNameFor({ name: null, email: null })).toBe("");
      expect(displayNameFor({})).toBe("");
    });
  });
});
