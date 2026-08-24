/**
 * @vitest-environment node
 *
 * Real-Postgres integration coverage for persisting the user-simulator and
 * judge model overrides on a Scenario and a run plan (SimulationSuite).
 *
 * Requires: PostgreSQL (Prisma). Runs unconditionally — every harness
 * provides Postgres.
 *
 * @see specs/scenarios/scenario-model-selection.feature
 * @see specs/suites/suite-model-selection.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaScenarioAdapter } from "@langwatch/scenario-server";

import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { prisma } from "../../db";
import { SuiteRepository } from "../../suites/suite.repository";

describe("Scenario / run-plan model persistence (real DB)", () => {
  const ns = `sim-models-${nanoid(8)}`;
  let projectId: string;
  let teamId: string;
  let organizationId: string;

  beforeAll(async () => {
    const org = await prisma.organization.create({
      data: { name: `Models Org ${ns}`, slug: `--models-${ns}` },
    });
    organizationId = org.id;
    const team = await prisma.team.create({
      data: {
        name: `Models Team ${ns}`,
        slug: `--models-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: `Models Proj ${ns}`,
        slug: `--models-proj-${ns}`,
        teamId,
        language: "typescript",
        framework: "other",
        apiKey: `models-key-${ns}`,
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
      ["project", { id: projectId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
  });

  describe("given a scenario", () => {
    describe("when it is updated with a simulator and judge model", () => {
      /** @scenario "Simulator and judge models are persisted on the scenario" */
      it("stores both model selections", async () => {
        const service = PrismaScenarioAdapter.create({
          prisma,
          generateId: () => `scenario_${nanoid()}`,
        });
        const created = await service.create({
          projectId,
          name: `Scenario ${ns}`,
          situation: "User asks for a refund",
          criteria: ["Agent is polite"],
          labels: [],
        });
        // Defaults to null until explicitly chosen.
        expect(created.simulatorModel).toBeNull();
        expect(created.judgeModel).toBeNull();

        const updated = await service.update(created.id, projectId, {
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-nano",
        });
        expect(updated.simulatorModel).toBe("openai/gpt-5-mini");
        expect(updated.judgeModel).toBe("openai/gpt-5-nano");

        const reread = await prisma.scenario.findFirst({
          where: { id: created.id, projectId },
        });
        expect(reread?.simulatorModel).toBe("openai/gpt-5-mini");
        expect(reread?.judgeModel).toBe("openai/gpt-5-nano");
      });
    });
  });

  describe("given a run plan", () => {
    describe("when it is saved with a simulator and judge model", () => {
      /** @scenario "Simulator and judge models are persisted on the run plan" */
      it("stores both model selections", async () => {
        const repo = new SuiteRepository(prisma);
        const created = await repo.create({
          projectId,
          name: `Run plan ${ns}`,
          slug: `run-plan-${ns}`,
          scenarioIds: [],
          targets: [],
          repeatCount: 1,
          labels: [],
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-nano",
        });
        expect(created.simulatorModel).toBe("openai/gpt-5-mini");
        expect(created.judgeModel).toBe("openai/gpt-5-nano");

        const reread = await prisma.simulationSuite.findFirst({
          where: { id: created.id, projectId },
        });
        expect(reread?.simulatorModel).toBe("openai/gpt-5-mini");
        expect(reread?.judgeModel).toBe("openai/gpt-5-nano");
      });
    });
  });
});
