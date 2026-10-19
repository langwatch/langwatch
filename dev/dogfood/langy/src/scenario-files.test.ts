import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readScenarioGroups } from "./sync-files.ts";
import { PROMPT_WORLD } from "./world-names.ts";

const SCENARIOS = fileURLToPath(new URL("../scenarios", import.meta.url));
const PLAN_FILE = fileURLToPath(new URL("../run-plan.json", import.meta.url));

describe("the checked-in scenarios", () => {
  const groups = readScenarioGroups({ dir: SCENARIOS, planFile: PLAN_FILE });
  const specs = groups.flatMap((group) => group.specs);

  it("parses every file into one plan per folder", () => {
    const folders = readdirSync(SCENARIOS, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    expect(groups).toHaveLength(folders.length + 1);
    for (const group of groups) expect(group.specs.length).toBeGreaterThan(0);
  });

  it("holds every scenario name once", () => {
    const names = specs.map((spec) => spec.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("runs the 49 wave 1a scenarios in the default world, one turn past their messages", () => {
    const migrated = specs.filter((spec) => spec.labels.includes("e2e-migrated"));
    expect(migrated).toHaveLength(49);
    for (const spec of migrated) {
      expect(spec.parameters, spec.name).toEqual([
        expect.objectContaining({ name: "world", defaultValue: PROMPT_WORLD }),
      ]);
      expect(spec.maxTurns, spec.name).toBeGreaterThanOrEqual(2);
    }
  });
});
