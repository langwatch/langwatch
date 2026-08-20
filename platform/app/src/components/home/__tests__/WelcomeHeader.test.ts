import { describe, expect, it } from "vitest";
import { displayFirstName } from "~/utils/displayName";
import { getGreeting, getTimeOfDay } from "../WelcomeHeader";

describe("WelcomeHeader", () => {
  describe("displayFirstName", () => {
    describe("when user has a full name", () => {
      /** @scenario Displays greeting with user's first name */
      it("extracts first name from 'John Doe'", () => {
        expect(displayFirstName("John Doe")).toBe("John");
      });

      /** @scenario Extracts first name from full name */
      it("extracts first name from multiple-word name 'Jane Maria Smith'", () => {
        expect(displayFirstName("Jane Maria Smith")).toBe("Jane");
      });

      it("returns single name when no space", () => {
        expect(displayFirstName("Alice")).toBe("Alice");
      });
    });

    describe("when name is an email address", () => {
      /** @scenario Displays friendly fallback when name is just email */
      it("returns null for 'johndoe@example.com'", () => {
        expect(displayFirstName("johndoe@example.com")).toBeNull();
      });

      it("returns null for 'user.name@domain.org'", () => {
        expect(displayFirstName("user.name@domain.org")).toBeNull();
      });
    });

    describe("when name is not available", () => {
      /** @scenario Displays friendly fallback when name unavailable */
      it("returns null for null", () => {
        expect(displayFirstName(null)).toBeNull();
      });

      it("returns null for undefined", () => {
        expect(displayFirstName(undefined)).toBeNull();
      });

      it("returns null for empty string", () => {
        expect(displayFirstName("")).toBeNull();
      });

      it("returns null for whitespace-only string", () => {
        expect(displayFirstName("   ")).toBeNull();
      });
    });
  });

  describe("getTimeOfDay", () => {
    describe("when hour is between 0 and 11", () => {
      it("returns morning", () => {
        expect(getTimeOfDay(0)).toBe("morning");
        expect(getTimeOfDay(6)).toBe("morning");
        expect(getTimeOfDay(11)).toBe("morning");
      });
    });

    describe("when hour is between 12 and 17", () => {
      it("returns afternoon", () => {
        expect(getTimeOfDay(12)).toBe("afternoon");
        expect(getTimeOfDay(15)).toBe("afternoon");
        expect(getTimeOfDay(17)).toBe("afternoon");
      });
    });

    describe("when hour is between 18 and 23", () => {
      it("returns evening", () => {
        expect(getTimeOfDay(18)).toBe("evening");
        expect(getTimeOfDay(21)).toBe("evening");
        expect(getTimeOfDay(23)).toBe("evening");
      });
    });
  });

  describe("getGreeting", () => {
    describe("when name is provided", () => {
      it("returns personalized morning greeting", () => {
        expect(getGreeting({ timeOfDay: "morning", name: "Alice" })).toBe(
          "Good morning, Alice",
        );
      });

      it("returns personalized afternoon greeting", () => {
        expect(getGreeting({ timeOfDay: "afternoon", name: "Bob" })).toBe(
          "Good afternoon, Bob",
        );
      });

      it("returns personalized evening greeting", () => {
        expect(getGreeting({ timeOfDay: "evening", name: "Carol" })).toBe(
          "Good evening, Carol",
        );
      });
    });

    describe("when name is null", () => {
      it("returns anonymous morning greeting", () => {
        expect(getGreeting({ timeOfDay: "morning", name: null })).toBe(
          "Good morning",
        );
      });

      it("returns anonymous afternoon greeting", () => {
        expect(getGreeting({ timeOfDay: "afternoon", name: null })).toBe(
          "Good afternoon",
        );
      });

      it("returns anonymous evening greeting", () => {
        expect(getGreeting({ timeOfDay: "evening", name: null })).toBe(
          "Good evening",
        );
      });
    });
  });
});
