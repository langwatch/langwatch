import { describe, expect, it } from "vitest";
import { freeName } from "../freeName";

describe("freeName", () => {
  describe("given no key carries the wanted name", () => {
    /** @scenario a replay of the gateway tour never mints a duplicate key name */
    it("keeps the wanted name", () => {
      expect(freeName({ wanted: "production-app", taken: [] })).toBe(
        "production-app",
      );
      expect(
        freeName({ wanted: "production-app", taken: ["staging-app"] }),
      ).toBe("production-app");
    });
  });

  describe("given the wanted name is taken", () => {
    /** @scenario a replay of the gateway tour never mints a duplicate key name */
    it("counts up from 2 past every taken suffix", () => {
      expect(
        freeName({ wanted: "production-app", taken: ["production-app"] }),
      ).toBe("production-app-2");
      expect(
        freeName({
          wanted: "production-app",
          taken: ["production-app", "production-app-2", "production-app-3"],
        }),
      ).toBe("production-app-4");
      expect(
        freeName({
          wanted: "production-app",
          taken: ["production-app", "production-app-3"],
        }),
      ).toBe("production-app-2");
    });
  });
});
