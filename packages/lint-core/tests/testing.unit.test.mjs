import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureWorkspace } from "../src/testing.mjs";

let workspace;

afterEach(() => workspace?.cleanup());

function catalogueOf(fixture) {
  return JSON.parse(readFileSync(join(fixture.cwd, "packages/features/catalogue.json"), "utf8"));
}

describe("given a fixture workspace", () => {
  describe("when the catalogue option names a feature's subjects", () => {
    /** @scenario "The catalogue option writes the shape the rules read" */
    it("writes the version and features shape the rules read", () => {
      workspace = createFixtureWorkspace({ catalogue: { project: ["project", "workspace"] } });

      expect(catalogueOf(workspace)).toEqual({
        version: 0,
        features: [{ id: "project", subjects: ["project", "workspace"] }],
      });
    });
  });

  describe("when no catalogue is given", () => {
    /** @scenario "An empty catalogue is still a readable catalogue file" */
    it("writes an empty but well-formed catalogue", () => {
      workspace = createFixtureWorkspace();

      expect(catalogueOf(workspace)).toEqual({ version: 0, features: [] });
    });
  });
});
