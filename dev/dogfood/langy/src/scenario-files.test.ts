import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readScenarioGroups } from "./sync-files.ts";
import { PROMPT_WORLD, RESOURCES_WORLD } from "./world-names.ts";

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

  it("runs the 66 migrated e2e scenarios, one turn past their messages", () => {
    const migrated = specs.filter((spec) => spec.labels.includes("e2e-migrated"));
    expect(migrated).toHaveLength(66);
    for (const spec of migrated) expect(spec.maxTurns, spec.name).toBeGreaterThanOrEqual(2);
  });

  it("runs 51 judge-only scenarios in the default world and 15 create runs in resources", () => {
    const worldOf = (spec: (typeof specs)[number]) =>
      spec.parameters.find((parameter) => parameter.name === "world")?.defaultValue;
    const migrated = specs.filter((spec) => spec.labels.includes("e2e-migrated"));
    expect(migrated.filter((spec) => worldOf(spec) === PROMPT_WORLD)).toHaveLength(51);
    const create = migrated.filter((spec) => worldOf(spec) === RESOURCES_WORLD);
    expect(create).toHaveLength(15);
    for (const spec of create) {
      expect(spec.parameters, spec.name).toHaveLength(1);
      expect(spec.situation, spec.name).toContain("<tag>");
      expect(
        spec.criteria.some((criterion) => criterion.startsWith("Code check: facts_now.new_")),
      ).toBe(true);
    }
  });
});
