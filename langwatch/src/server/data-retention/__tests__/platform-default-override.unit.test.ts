import { describe, expect, it } from "vitest";
import { resolvePlatformDefaultRetentionDays } from "../retentionPolicy.schema";

describe("resolvePlatformDefaultRetentionDays", () => {
  describe("given the variable is not set", () => {
    // @scenario "An unset variable resolves to the fixed platform default"
    it("resolves to the fixed 49-day platform default", () => {
      expect(resolvePlatformDefaultRetentionDays({ NODE_ENV: "production" })).toBe(
        49,
      );
      expect(
        resolvePlatformDefaultRetentionDays({
          NODE_ENV: "development",
          LANGWATCH_DEFAULT_RETENTION_DAYS: "",
        }),
      ).toBe(49);
    });
  });

  describe("given a dev stack lowers the default", () => {
    // @scenario "A dev stack lowers the default to a week"
    it("resolves to the overridden whole-week value", () => {
      expect(
        resolvePlatformDefaultRetentionDays({
          NODE_ENV: "development",
          LANGWATCH_DEFAULT_RETENTION_DAYS: "7",
        }),
      ).toBe(7);
    });
  });

  describe("given the override is set in production", () => {
    // @scenario "Setting the override in production fails loud"
    it("throws an error naming the variable and forbidding it in production", () => {
      const act = () =>
        resolvePlatformDefaultRetentionDays({
          NODE_ENV: "production",
          LANGWATCH_DEFAULT_RETENTION_DAYS: "7",
        });
      expect(act).toThrow(/LANGWATCH_DEFAULT_RETENTION_DAYS/);
      expect(act).toThrow(/production/);
    });
  });

  describe("given an override that is not a whole number of weeks", () => {
    // @scenario "A default that is not a whole number of weeks fails loud"
    it("throws an error about whole weeks", () => {
      for (const bad of ["10", "0", "-7", "3.5", "week"]) {
        expect(() =>
          resolvePlatformDefaultRetentionDays({
            NODE_ENV: "development",
            LANGWATCH_DEFAULT_RETENTION_DAYS: bad,
          }),
        ).toThrow(/whole number of weeks/);
      }
    });
  });
});
