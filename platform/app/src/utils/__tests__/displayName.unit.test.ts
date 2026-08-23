import { describe, expect, it } from "vitest";
import { displayFirstName } from "../displayName";

describe("given a name to greet someone by", () => {
  describe("when the name has several parts", () => {
    /** @scenario Displays greeting with user's first name */
    it("takes the first", () => {
      expect(displayFirstName("John Doe")).toBe("John");
    });

    /** @scenario Extracts first name from full name */
    it("takes the first of three", () => {
      expect(displayFirstName("Jane Maria Smith")).toBe("Jane");
    });

    it("takes the first across a tab or a newline", () => {
      expect(displayFirstName("Jane\tDoe")).toBe("Jane");
      expect(displayFirstName("Jane\nDoe")).toBe("Jane");
    });
  });

  describe("when the name is a single word", () => {
    it("uses the whole of it", () => {
      expect(displayFirstName("Alice")).toBe("Alice");
    });
  });

  describe("when the name is an email address", () => {
    /** @scenario Displays friendly fallback when name is just email */
    it("refuses to call anyone by their address", () => {
      expect(displayFirstName("johndoe@example.com")).toBeNull();
    });

    it("refuses a dotted local part too", () => {
      expect(displayFirstName("user.name@domain.org")).toBeNull();
    });
  });

  describe("when there is no name", () => {
    /** @scenario Displays friendly fallback when name unavailable */
    it("has nothing to offer for null", () => {
      expect(displayFirstName(null)).toBeNull();
    });

    it("has nothing to offer for undefined", () => {
      expect(displayFirstName(undefined)).toBeNull();
    });

    it("has nothing to offer for an empty string", () => {
      expect(displayFirstName("")).toBeNull();
    });

    it("has nothing to offer for whitespace alone", () => {
      expect(displayFirstName("   ")).toBeNull();
    });
  });
});
