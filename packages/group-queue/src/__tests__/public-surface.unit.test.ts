import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as root from "../index.ts";
import * as operational from "../operational.ts";

const packageJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8"),
) as { exports: Record<string, unknown> };

const ENTRIES: Record<string, Record<string, unknown>> = {
  ".": root,
  "./operational": operational,
};

function describeEntry(entry: Record<string, unknown>): Record<string, string> {
  const listing: Record<string, string> = {};
  for (const name of Object.keys(entry).toSorted()) {
    const value = entry[name];
    const kind = typeof value;
    const prototype = kind === "function" ? (value as { prototype?: object }).prototype : undefined;
    const methods = prototype
      ? Object.getOwnPropertyNames(prototype)
          .filter((method) => method !== "constructor")
          .toSorted()
      : [];
    listing[name] = methods.length > 0 ? `${kind} [${methods.join(", ")}]` : kind;
  }
  return listing;
}

describe("group-queue public surface", () => {
  describe("given the package exports map", () => {
    /** @scenario "Every package entry keeps its runtime surface" */
    it("has exactly the entries this test covers", () => {
      expect(Object.keys(packageJson.exports).toSorted()).toEqual(Object.keys(ENTRIES).toSorted());
    });

    /** @scenario "Every package entry keeps its runtime surface" */
    it.each(Object.keys(ENTRIES))("keeps the runtime surface of entry %s", (entryName) => {
      expect(describeEntry(ENTRIES[entryName]!)).toMatchSnapshot();
    });
  });
});
