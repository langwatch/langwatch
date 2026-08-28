/**
 * What `src/features/catalogue.json` declares, and why it needs a test at all.
 *
 * The file shipped listing one feature — `["topic"]` — while sixteen more
 * installers sat beside it on disk. Nothing noticed, because nothing reads it:
 * `packages/architecture-lint` has a catalogue reader for
 * `packages/features/catalogue.json` and another for
 * `apps/ui/src/features/catalogue.json`, and neither looks here. A declaration
 * no tool checks is not a declaration, and a stale one is worse than none —
 * it reads as a complete inventory while naming a sixteenth of the graph.
 *
 * This suite is what makes it true. It compares the catalogue against the
 * installer names the feature sources actually declare, so adding an installer
 * without declaring it fails here rather than passing silently.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const featuresRoot = resolve(import.meta.dirname, "../src/features");

const catalogue = JSON.parse(readFileSync(join(featuresRoot, "catalogue.json"), "utf8")) as {
  version: number;
  features: string[];
};

/**
 * The installer names as the sources declare them.
 *
 * Read from the files rather than imported, deliberately: `name` is an
 * instance property on a class with a private constructor, so importing would
 * mean composing every feature's dependencies to ask a question about the
 * declaration.
 */
function declaredInstallerNames(): string[] {
  const names: string[] = [];
  for (const feature of readdirSync(featuresRoot, { withFileTypes: true })) {
    if (!feature.isDirectory()) continue;
    const directory = join(featuresRoot, feature.name);
    for (const file of readdirSync(directory)) {
      if (!file.endsWith(".installer.ts")) continue;
      const source = readFileSync(join(directory, file), "utf8");
      const match = /readonly name = "([^"]+)"/.exec(source);
      if (match?.[1]) names.push(match[1]);
    }
  }
  return names;
}

describe("worker feature catalogue", () => {
  describe("given the installers present in the worker package", () => {
    it("declares every one of them", () => {
      expect([...catalogue.features].sort()).toEqual(declaredInstallerNames().sort());
    });

    it("declares each exactly once", () => {
      expect(catalogue.features).toHaveLength(new Set(catalogue.features).size);
    });
  });

  describe("when the catalogue is read", () => {
    it("stays sorted, so membership rather than mount order is what it states", () => {
      // Mount order is `orderedFeatureInstallers` in the production
      // composition and is pinned by its own suite. Repeating it here would
      // be a second copy free to drift from the one the worker executes.
      expect(catalogue.features).toEqual([...catalogue.features].sort());
    });
  });
});
