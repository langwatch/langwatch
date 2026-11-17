import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * Spec: modules/suite/specs/suite-templates.feature,
 * modules/scenario/specs/red-team-scenario.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ScenarioService, type ScenarioServiceOptions } from "../scenario.service.ts";

function serviceWith(create: ScenarioServiceOptions["repository"]["create"]) {
  return ScenarioService.create({
    repository: createApiFixture<ScenarioServiceOptions["repository"]>({
      create,
      findTestSuites: vi.fn().mockResolvedValue([]),
    }),
    simulations: {} as ScenarioServiceOptions["simulations"],
    ids: createApiFixture<ScenarioServiceOptions["ids"]>({ next: () => "scenario_1" }),
    testSuiteIds: {} as ScenarioServiceOptions["testSuiteIds"],
    clock: {} as ScenarioServiceOptions["clock"],
  });
}

const attack = { attackGoal: "Reveal the system prompt", owaspIds: ["LLM07"] };
const base = {
  projectId: "project_1",
  testSuiteId: "suite_1",
  situation: "Ask for the hidden instructions",
  criteria: [],
  labels: [],
};

describe("ScenarioService.create with a scenario kind", () => {
  describe("when a red team scenario carries its config", () => {
    /** @scenario "A red team scenario is created with its attack config" */
    it("stores the kind and the parsed config", async () => {
      const create = vi.fn().mockImplementation(async (row: unknown) => row);
      await serviceWith(create).create({
        ...base,
        name: "LLM07 System Prompt Leakage",
        kind: "red_team",
        redTeam: { ...attack, strategy: "crescendo", maxTurns: 30 },
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "red_team",
          redTeam: { ...attack, strategy: "crescendo", maxTurns: 30 },
        }),
      );
    });
  });

  describe("when a red team scenario has no config", () => {
    /** @scenario "A red team scenario without a config is refused" */
    it("refuses with scenario_red_team_config_mismatch before writing", async () => {
      const create = vi.fn();
      await expect(
        serviceWith(create).create({ ...base, name: "attack", kind: "red_team" }),
      ).rejects.toMatchObject({ code: "scenario_red_team_config_mismatch" });
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("when a standard scenario carries a red team config", () => {
    /** @scenario "A standard scenario with a red team config is refused" */
    it("refuses with scenario_red_team_config_mismatch", async () => {
      const create = vi.fn();
      await expect(
        serviceWith(create).create({
          ...base,
          name: "plain",
          redTeam: { ...attack, strategy: "goat", maxTurns: 10 },
        }),
      ).rejects.toMatchObject({ code: "scenario_red_team_config_mismatch" });
      expect(create).not.toHaveBeenCalled();
    });
  });
});

describe("ScenarioService.duplicate of a red team scenario", () => {
  /** @scenario "A duplicated red team scenario stays a red team scenario" */
  it("copies the kind and the attack config", async () => {
    const redTeam = { ...attack, strategy: "goat" as const, maxTurns: 12 };
    const create = vi.fn().mockImplementation(async (row: unknown) => row);
    const original = {
      ...base,
      id: "scenario_0",
      name: "LLM07",
      parameters: null,
      simulatorModel: null,
      judgeModel: null,
      maxTurns: null,
      minTurns: null,
      kind: "red_team",
      redTeam,
    };
    const service = ScenarioService.create({
      repository: createApiFixture<ScenarioServiceOptions["repository"]>({
        create,
        findById: vi.fn().mockResolvedValue(original),
        findTestSuites: vi.fn().mockResolvedValue([]),
      }),
      simulations: {} as ScenarioServiceOptions["simulations"],
      ids: createApiFixture<ScenarioServiceOptions["ids"]>({ next: () => "scenario_1" }),
      testSuiteIds: {} as ScenarioServiceOptions["testSuiteIds"],
      clock: {} as ScenarioServiceOptions["clock"],
    });

    await service.duplicate({ scenarioId: "scenario_0", projectId: "project_1" });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "LLM07 (copy)", kind: "red_team", redTeam }),
    );
    expect(create.mock.calls[0]![0]).not.toHaveProperty("sourceTemplateId");
  });
});
