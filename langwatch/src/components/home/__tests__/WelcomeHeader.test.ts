import { describe, expect, it } from "vitest";
import { getGreetingName } from "../WelcomeHeader";

describe("WelcomeHeader", () => {
  describe("getGreetingName", () => {
    describe("when user has a full name", () => {
      it("extracts first name from 'John Doe'", () => {
        expect(getGreetingName("John Doe")).toBe("John");
      });

      it("extracts first name from multiple-word name 'Jane Maria Smith'", () => {
        expect(getGreetingName("Jane Maria Smith")).toBe("Jane");
      });

      it("returns single name when no space", () => {
        expect(getGreetingName("Alice")).toBe("Alice");
      });
    });

    describe("when name is an email address", () => {
      it("returns null for 'johndoe@example.com'", () => {
        expect(getGreetingName("johndoe@example.com")).toBeNull();
      });

      it("returns null for 'user.name@domain.org'", () => {
        expect(getGreetingName("user.name@domain.org")).toBeNull();
      });
    });

    describe("when name is not available", () => {
      it("returns null for null", () => {
        expect(getGreetingName(null)).toBeNull();
      });

      it("returns null for undefined", () => {
        expect(getGreetingName(undefined)).toBeNull();
      });

      it("returns null for empty string", () => {
        expect(getGreetingName("")).toBeNull();
      });

      it("returns null for whitespace-only string", () => {
        expect(getGreetingName("   ")).toBeNull();
      });
    });
  });
});
