/**
 * Freezes the exported names of every package entry so a refactor cannot add,
 * drop or reshape a public export without the snapshot saying so.
 */
import { describe, expect, it } from "vitest";

const ENTRIES = {
  ".": () => import("../index.ts"),
  "./testing": () => import("../testing.ts"),
  "./server": () => import("../server/index.ts"),
  "./tables": () => import("../server/tables/event-table-declarations.ts"),
} as const;

function surfaceOf(moduleExports: Record<string, unknown>): string[] {
  return Object.keys(moduleExports)
    .sort()
    .map((name) => {
      const value = moduleExports[name];
      if (
        typeof value !== "function" ||
        !/^class\s/.test(Function.prototype.toString.call(value))
      ) {
        return `${name}: ${typeof value}`;
      }
      const methods = Object.getOwnPropertyNames(value.prototype as object)
        .filter((method) => method !== "constructor")
        .sort();
      return `${name}: class [${methods.join(", ")}]`;
    });
}

describe("the @langwatch/eventing public surface", () => {
  describe.each(Object.entries(ENTRIES))("given the %s entry", (entry, load) => {
    /** @scenario "Every package entry exposes a recorded public surface" */
    it("exports exactly the recorded names and kinds", async () => {
      expect(surfaceOf(await load())).toMatchSnapshot(entry);
    });
  });
});
