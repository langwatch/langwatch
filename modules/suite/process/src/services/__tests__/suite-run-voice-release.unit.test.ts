/**
 * @vitest-environment node
 * @see specs/features/agents/voice-agents-v1.feature
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import { VOICE_AGENTS_FLAG_KEY, type FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";
import type { Suite, SuiteTarget } from "@langwatch/suite-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { SuiteExecution } from "../../app/suite.app.ts";
import type { SuiteRepository } from "../../repositories/suite.repository.ts";
import { SuiteService } from "../suite.service.ts";

const projectId = "project-1";
const organizationId = "org-1";
const voiceTarget: SuiteTarget = { type: "voice", referenceId: "agent-voice" };
const httpTarget: SuiteTarget = { type: "http", referenceId: "agent-http" };

function storedSuite(targets: SuiteTarget[]): Suite {
  return {
    id: "suite-1",
    projectId,
    name: "Voice suite",
    slug: "voice-suite",
    kind: "run_plan",
    description: null,
    scenarioIds: ["scenario-1"],
    scope: { mode: "scenarios" },
    targets,
    repeatCount: 1,
    labels: [],
    simulatorModel: null,
    judgeModel: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function buildService({
  voiceEnabled,
  targets,
}: {
  voiceEnabled: boolean;
  targets: SuiteTarget[];
}) {
  const isEnabled = vi.fn(async () => voiceEnabled);
  const findById = vi.fn(async () => storedSuite(targets));
  const findOrCreatePlanByName = vi.fn();
  const saveManagedRunAll = vi.fn();
  const getReferenceStates = vi.fn(async () => []);
  const getRunConfigs = vi.fn(async () => []);
  const list = vi.fn(async () => []);
  const execute = vi.fn();
  const resolveAgents = vi.fn(async () => []);

  const service = SuiteService.create({
    repository: createApiFixture<SuiteRepository>(
      { findById, findOrCreatePlanByName, saveManagedRunAll },
      "SuiteRepository",
    ),
    scenarios: createApiFixture<ScenarioApi>({ getReferenceStates, getRunConfigs, list }),
    agents: createApiFixture<AgentApi>({
      getReferenceStates: resolveAgents,
      getConnectedByName: resolveAgents,
    }),
    prompts: createApiFixture<PromptApi>({}),
    evaluators: createApiFixture<EvaluatorApi>({}),
    featureFlags: createApiFixture<FeatureFlagApi>({ isEnabled }),
    execution: createApiFixture<SuiteExecution>({ execute }, "SuiteExecution"),
  });

  return {
    service,
    isEnabled,
    untouched: [
      findOrCreatePlanByName,
      saveManagedRunAll,
      getReferenceStates,
      getRunConfigs,
      list,
      resolveAgents,
      execute,
    ],
  };
}

describe("a suite run naming a voice target", () => {
  describe("when the project's release_voice_agents_enabled flag is off", () => {
    /** @scenario "A run against a voice target is refused while the project's flag is off" */
    it("refuses the run before anything is resolved or queued", async () => {
      const { service, isEnabled, untouched } = buildService({
        voiceEnabled: false,
        targets: [httpTarget, voiceTarget],
      });

      const refusal = await service
        .run({ id: "suite-1", projectId, organizationId, idempotencyKey: "idem-1" })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "voice_agents_disabled", httpStatus: 403 });
      expect(isEnabled).toHaveBeenCalledWith(VOICE_AGENTS_FLAG_KEY, {
        kind: "project",
        projectId,
        organizationId,
      });
      for (const collaborator of untouched) expect(collaborator).not.toHaveBeenCalled();
    });

    it("refuses a run plan before its plan row is written", async () => {
      const { service, untouched } = buildService({ voiceEnabled: false, targets: [] });

      await expect(
        service.runPlan({
          projectId,
          organizationId,
          name: "Voice plan",
          config: { scope: { mode: "scenarios" }, targets: [voiceTarget], scenarioIds: ["s-1"] },
          idempotencyKey: "idem-1",
        }),
      ).rejects.toMatchObject({ code: "voice_agents_disabled" });
      for (const collaborator of untouched) expect(collaborator).not.toHaveBeenCalled();
    });

    it("refuses Run all before the managed Run-all suite is written", async () => {
      const { service, untouched } = buildService({ voiceEnabled: false, targets: [] });

      await expect(
        service.runAll({
          projectId,
          organizationId,
          targets: [voiceTarget],
          idempotencyKey: "idem-1",
        }),
      ).rejects.toMatchObject({ code: "voice_agents_disabled" });
      for (const collaborator of untouched) expect(collaborator).not.toHaveBeenCalled();
    });
  });

  describe("when the project's flag is on", () => {
    it("lets the run go on to resolve its scenarios", async () => {
      const { service } = buildService({ voiceEnabled: true, targets: [voiceTarget] });

      await expect(
        service.run({ id: "suite-1", projectId, organizationId, idempotencyKey: "idem-1" }),
      ).rejects.toMatchObject({ code: "suite_invalid_scenario_references" });
    });
  });

  describe("when no target is a voice agent", () => {
    it("never asks the flag", async () => {
      const { service, isEnabled } = buildService({ voiceEnabled: false, targets: [httpTarget] });

      await expect(
        service.run({ id: "suite-1", projectId, organizationId, idempotencyKey: "idem-1" }),
      ).rejects.toMatchObject({ code: "suite_invalid_scenario_references" });
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });
});
