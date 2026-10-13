import { describe, expect, it } from "vitest";

import { freeVirtualKeyName } from "../free-virtual-key-name.ts";

describe("freeVirtualKeyName", () => {
  describe("given no key carries the wanted name", () => {
    it("keeps the wanted name", () => {
      expect(freeVirtualKeyName({ wanted: "production-app", taken: [] })).toBe("production-app");
      expect(freeVirtualKeyName({ wanted: "production-app", taken: ["staging-app"] })).toBe(
        "production-app",
      );
    });
  });

  describe("given the wanted name is taken", () => {
    it("counts up from 2 to the first suffix no key carries", () => {
      expect(freeVirtualKeyName({ wanted: "production-app", taken: ["production-app"] })).toBe(
        "production-app-2",
      );
      expect(
        freeVirtualKeyName({
          wanted: "production-app",
          taken: ["production-app", "production-app-2", "production-app-3"],
        }),
      ).toBe("production-app-4");
      expect(
        freeVirtualKeyName({
          wanted: "production-app",
          taken: ["production-app", "production-app-3"],
        }),
      ).toBe("production-app-2");
    });
  });
});
