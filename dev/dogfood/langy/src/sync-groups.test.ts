import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readScenarioGroups } from "./sync-files.ts";

let root: string;
let dir: string;
let planFile: string;

function write({ path, json }: { path: string; json: unknown }): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(json));
}

function scenario({ path, name }: { path: string; name: string }): void {
  write({ path: join(dir, path), json: { name, situation: `Ask about ${name}.` } });
}

function plan({ path, name }: { path: string; name: string }): void {
  write({ path, json: { name, agent: "langy" } });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langy-sync-groups-"));
  dir = join(root, "scenarios");
  planFile = join(root, "run-plan.json");
  mkdirSync(dir);
  plan({ path: planFile, name: "Top plan" });
  scenario({ path: "d1.json", name: "D1" });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("readScenarioGroups", () => {
  it("keeps the top-level files on the top-level plan when there are no groups", () => {
    const groups = readScenarioGroups({ dir, planFile });
    expect(groups.map((group) => [group.plan.name, group.specs.map((spec) => spec.name)])).toEqual([
      ["Top plan", ["D1"]],
    ]);
  });

  it("makes each subfolder with a run-plan.json its own plan, never a scenario", () => {
    scenario({ path: "core/0091-traces.json", name: "E2E core 91" });
    scenario({ path: "core/0116-cost.json", name: "E2E core 116" });
    plan({ path: join(dir, "core", "run-plan.json"), name: "Core plan" });
    scenario({ path: "boundary/0031-key.json", name: "E2E boundary 31" });
    plan({ path: join(dir, "boundary", "run-plan.json"), name: "Boundary plan" });

    const groups = readScenarioGroups({ dir, planFile });
    expect(groups.map((group) => [group.plan.name, group.specs.map((spec) => spec.name)])).toEqual([
      ["Top plan", ["D1"]],
      ["Boundary plan", ["E2E boundary 31"]],
      ["Core plan", ["E2E core 91", "E2E core 116"]],
    ]);
  });

  it("refuses a subfolder without a run-plan.json", () => {
    scenario({ path: "orphans/x.json", name: "X" });
    expect(() => readScenarioGroups({ dir, planFile })).toThrow(
      "orphans/: has no run-plan.json; every group needs its own run plan",
    );
  });

  it("refuses a scenario name used in two groups, naming both files", () => {
    scenario({ path: "core/d1-again.json", name: "D1" });
    plan({ path: join(dir, "core", "run-plan.json"), name: "Core plan" });
    expect(() => readScenarioGroups({ dir, planFile })).toThrow(
      'Scenario names must be unique across all groups: "D1" (d1.json, core/d1-again.json)',
    );
  });

  it("refuses two groups that name one run plan", () => {
    scenario({ path: "core/a.json", name: "A" });
    plan({ path: join(dir, "core", "run-plan.json"), name: "Top plan" });
    expect(() => readScenarioGroups({ dir, planFile })).toThrow(/Run plan names must be unique/);
  });

  it("names the group file that is malformed", () => {
    write({
      path: join(dir, "core", "bad.json"),
      json: { name: "Bad", situation: "x", labels: 1 },
    });
    plan({ path: join(dir, "core", "run-plan.json"), name: "Core plan" });
    expect(() => readScenarioGroups({ dir, planFile })).toThrow(
      'core/bad.json: "labels" must be a list of strings',
    );
  });
});
