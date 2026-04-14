import { describe, expect, it } from "vitest";
import {
  getGreetingName,
  getTimeOfDay,
  getGreeting,
} from "../WelcomeHeader";

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

  describe("getTimeOfDay", () => {
    it("returns morning for hours 0-11", () => {
      expect(getTimeOfDay(0)).toBe("morning");
      expect(getTimeOfDay(6)).toBe("morning");
      expect(getTimeOfDay(11)).toBe("morning");
    });

    it("returns afternoon for hours 12-17", () => {
      expect(getTimeOfDay(12)).toBe("afternoon");
      expect(getTimeOfDay(15)).toBe("afternoon");
      expect(getTimeOfDay(17)).toBe("afternoon");
    });

    it("returns evening for hours 18-23", () => {
      expect(getTimeOfDay(18)).toBe("evening");
      expect(getTimeOfDay(21)).toBe("evening");
      expect(getTimeOfDay(23)).toBe("evening");
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
