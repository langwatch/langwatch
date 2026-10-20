import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { RESOURCE_SEEDS } from "./resources-world.ts";
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

  it("runs the 71 migrated e2e scenarios, one turn past their messages", () => {
    const migrated = specs.filter((spec) => spec.labels.includes("e2e-migrated"));
    expect(migrated).toHaveLength(71);
    for (const spec of migrated) expect(spec.maxTurns, spec.name).toBeGreaterThanOrEqual(2);
  });

  const parameterOf = (spec: (typeof specs)[number], name: string) =>
    spec.parameters.find((parameter) => parameter.name === name)?.defaultValue;
  const migrated = specs.filter((spec) => spec.labels.includes("e2e-migrated"));
  const resources = migrated.filter((spec) => parameterOf(spec, "world") === RESOURCES_WORLD);

  it("runs 51 judge-only scenarios in the default world and 20 in resources", () => {
    expect(migrated.filter((spec) => parameterOf(spec, "world") === PROMPT_WORLD)).toHaveLength(51);
    expect(resources).toHaveLength(20);
  });

  it("runs 15 create runs in resources, each with a tagged name and a new_ code check", () => {
    const create = resources.filter((spec) => parameterOf(spec, "seed") === undefined);
    expect(create).toHaveLength(15);
    for (const spec of create) {
      expect(spec.parameters, spec.name).toHaveLength(1);
      expect(spec.situation, spec.name).toContain("<tag>");
      expect(
        spec.criteria.some((criterion) => criterion.startsWith("Code check: facts_now.new_")),
      ).toBe(true);
    }
  });

  it("runs 5 change runs in resources, each naming a seed setup knows", () => {
    const change = resources.filter((spec) => parameterOf(spec, "seed") !== undefined);
    expect(change.map((spec) => parameterOf(spec, "seed")).toSorted()).toEqual([
      "evaluator",
      "evaluator_pair",
      "prompt",
      "stale_traces",
      "trace",
    ]);
    for (const spec of change) expect(RESOURCE_SEEDS).toContain(parameterOf(spec, "seed"));
  });
});
