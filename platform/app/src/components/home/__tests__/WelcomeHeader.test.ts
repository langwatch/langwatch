import { describe, expect, it } from "vitest";
import { getGreeting, getTimeOfDay } from "../WelcomeHeader";

describe("given the home page greeting", () => {
  describe("when reading the hour as a time of day", () => {
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

  describe("when building the greeting line", () => {
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
