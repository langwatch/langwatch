/**
 * @vitest-environment node
 *
 * Cloud Free creation caps on the API-key REST surface (what the CLI and SDKs
 * call), against a real database. Only the plan provider is stubbed.
 *
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { PLAN_LIMITS } from "../../../../ee/billing/planLimits";
import { PlanTypes } from "../../../../ee/billing/planTypes";
import type { PlanInfo } from "../../../../ee/licensing/planInfo";
import { app as evaluatorsApp } from "../evaluators/[[...route]]/app";
import { app as scenariosApp } from "../scenarios/[[...route]]/app";

const plan: { current: PlanInfo } = { current: PLAN_LIMITS[PlanTypes.FREE] };

wireDefaultTestApp(() => ({
  planProvider: PlanProviderService.create({
    getActivePlan: async () => plan.current,
  }),
}));

describe("cloud Free creation caps on the REST API", () => {
  const ns = `free-caps-rest-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let apiKey: string;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME Free REST", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "ACME", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: `--test-project-${ns}` }),
        teamId,
        personalFeatures: {},
      },
    });
    projectId = project.id;
    apiKey = project.apiKey;
  });

  beforeEach(async () => {
    plan.current = PLAN_LIMITS[PlanTypes.FREE];
    await cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
      ["evaluator", { projectId }],
    ]);
  });

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
      ["evaluator", { projectId }],
      ["project", { id: projectId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]),
  );

  const post = (
    target: {
      request: (
        path: string,
        init: RequestInit,
      ) => Response | Promise<Response>;
    },
    path: string,
    body: Record<string, unknown>,
  ) =>
    target.request(path, {
      method: "POST",
      headers: { "X-Auth-Token": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const seedScenarios = (count: number) =>
    prisma.scenario.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        id: `scen_${ns}_${i}`,
        projectId,
        name: `Scenario ${i}`,
        situation: "A customer asks for a refund",
        criteria: ["The agent helps"],
        labels: [],
      })),
    });

  const seedEvaluators = (count: number) =>
    prisma.evaluator.createMany({
      data: Array.from({ length: count }, (_, i) => ({
        id: `evaluator_${ns}_${i}`,
        projectId,
        name: `Evaluator ${i}`,
        slug: `evaluator-${ns}-${i}`,
        type: "evaluator",
        config: { evaluatorType: "langevals/exact_match", settings: {} },
      })),
    });

  describe("given the organization is on the cloud Free plan", () => {
    describe("when it has 3 active scenarios and POST /api/scenarios creates another", () => {
      /** @scenario Creating a fourth scenario through the API is refused with the limit shape */
      it("answers 403 with limit type, current and max", async () => {
        await seedScenarios(3);

        const res = await post(scenariosApp, "/api/scenarios", {
          name: "Fourth",
          situation: "A customer wants to cancel",
          criteria: ["The agent confirms the date"],
          labels: [],
        });

        expect(res.status).toBe(403);
        const text = JSON.stringify(await res.json());
        expect(text).toContain('"limitType":"scenarios"');
        expect(text).toContain('"current":3');
        expect(text).toContain('"max":3');
        expect(
          await prisma.scenario.count({
            where: { projectId, archivedAt: null },
          }),
        ).toBe(3);
      });
    });

    describe("when it has 3 custom evaluators and POST /api/evaluators creates another", () => {
      /** @scenario Creating a fourth custom evaluator through the API is refused with the limit shape */
      it("answers 403 with limit type, current and max", async () => {
        await seedEvaluators(3);

        const res = await post(evaluatorsApp, "/api/evaluators", {
          name: "Fourth",
          config: { evaluatorType: "langevals/exact_match", settings: {} },
        });

        expect(res.status).toBe(403);
        const text = JSON.stringify(await res.json());
        expect(text).toContain('"limitType":"evaluators"');
        expect(text).toContain('"current":3');
        expect(text).toContain('"max":3');
      });
    });
  });

  describe("given the organization is on a paid cloud plan", () => {
    describe("when it already has 3 custom evaluators", () => {
      it("creates a fourth through the API", async () => {
        plan.current = PLAN_LIMITS[PlanTypes.LAUNCH];
        await seedEvaluators(3);

        const res = await post(evaluatorsApp, "/api/evaluators", {
          name: "Fourth",
          config: { evaluatorType: "langevals/exact_match", settings: {} },
        });

        expect(res.status).toBe(200);
      });
    });
  });
});
