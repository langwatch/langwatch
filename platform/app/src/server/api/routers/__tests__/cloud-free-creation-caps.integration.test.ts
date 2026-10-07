/**
 * @vitest-environment node
 *
 * Cloud Free creation caps through the tRPC surface, against a real database.
 * Only the plan provider is stubbed (system boundary): it answers the cloud
 * Free plan or a paid plan as each test needs.
 *
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { LimitExceededError } from "~/server/license-enforcement/errors";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { PLAN_LIMITS } from "../../../../../ee/billing/planLimits";
import { PlanTypes } from "../../../../../ee/billing/planTypes";
import type { PlanInfo } from "../../../../../ee/licensing/planInfo";
import { prisma } from "../../../db";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const plan: { current: PlanInfo } = { current: PLAN_LIMITS[PlanTypes.FREE] };

wireDefaultTestApp(() => ({
  planProvider: PlanProviderService.create({
    getActivePlan: async () => plan.current,
  }),
}));

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to be refused");
}

describe("cloud Free creation caps", () => {
  const ns = `free-caps-${nanoid(8)}`;
  let organizationId: string;
  let teamId: string;
  let projectId: string;
  let otherProjectId: string;
  let userId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME Free", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "ACME", slug: `--test-team-${ns}`, organizationId },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: "ACME Project",
        slug: `--test-project-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;
    const otherProject = await prisma.project.create({
      data: {
        name: "ACME Second Project",
        slug: `--test-project-b-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId,
        language: "en",
        framework: "test",
      },
    });
    otherProjectId = otherProject.id;
    const user = await prisma.user.create({
      data: { name: "ACME Admin", email: `admin-${ns}@example.com` },
    });
    userId = user.id;
    await prisma.organizationUser.create({
      data: { userId, organizationId, role: OrganizationUserRole.ADMIN },
    });
    await prisma.teamUser.create({
      data: { userId, teamId, role: TeamUserRole.ADMIN },
    });
    await seedRoleBinding(prisma, {
      organizationId,
      userId,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.TEAM,
      scopeId: teamId,
    });
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: userId }, expires: "1" },
      }),
    );
  });

  beforeEach(async () => {
    plan.current = PLAN_LIMITS[PlanTypes.FREE];
    await cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
      ["evaluator", { projectId: { in: [projectId, otherProjectId] } }],
      ["workflow", { projectId }],
    ]);
  });

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId }],
      ["scenario", { projectId }],
      ["simulationSuite", { projectId }],
      ["evaluator", { projectId: { in: [projectId, otherProjectId] } }],
      ["workflow", { projectId }],
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["grant", { organizationId }],
      ["roleBinding", { organizationId }],
      ["teamUser", { teamId }],
      ["organizationUser", { organizationId }],
      ["team", { id: teamId }],
      ["user", { id: userId }],
      ["organization", { id: organizationId }],
    ]),
  );

  const createScenario = (name: string) =>
    caller.scenarios.create({
      projectId,
      name,
      situation: "A customer asks for a refund",
      criteria: ["The agent helps"],
      labels: [],
    });

  const createEvaluator = (name: string) =>
    caller.evaluators.create({
      projectId,
      name,
      type: "evaluator",
      config: {
        evaluatorType: "langevals/exact_match",
        settings: { caseSensitive: false },
      },
    });

  describe("given the organization is on the cloud Free plan", () => {
    describe("when it has 3 active scenarios and a member saves a new one", () => {
      /** @scenario Creating a fourth scenario in the app is refused with the upgrade shape */
      it("refuses as FORBIDDEN with limit type, current and max", async () => {
        for (const name of ["One", "Two", "Three"]) {
          await createScenario(name);
        }

        const error = await refusal(createScenario("Four"));

        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe("FORBIDDEN");
        const cause = (error as TRPCError).cause;
        expect(cause).toBeInstanceOf(LimitExceededError);
        expect((cause as LimitExceededError).meta).toEqual({
          limitType: "scenarios",
          current: 3,
          max: 3,
        });
        expect(
          await prisma.scenario.count({
            where: { projectId, archivedAt: null },
          }),
        ).toBe(3);
      });
    });

    describe("when it has 5 active scenarios and a member edits one", () => {
      /** @scenario An organization over the scenario cap can still edit its scenarios */
      it("saves the change", async () => {
        plan.current = PLAN_LIMITS[PlanTypes.LAUNCH];
        const created = [];
        for (const name of ["One", "Two", "Three", "Four", "Five"]) {
          created.push(await createScenario(name));
        }
        plan.current = PLAN_LIMITS[PlanTypes.FREE];

        await caller.scenarios.update({
          projectId,
          id: created[0]!.id,
          name: "One, edited",
        });

        const edited = await prisma.scenario.findFirst({
          where: { id: created[0]!.id, projectId },
        });
        expect(edited?.name).toBe("One, edited");
      });
    });

    describe("when it has 3 active custom evaluators and a member saves a new one", () => {
      /** @scenario Creating a fourth custom evaluator in the app is refused with the upgrade shape */
      it("refuses as FORBIDDEN with limit type, current and max", async () => {
        for (const name of ["One", "Two", "Three"]) {
          await createEvaluator(name);
        }

        const error = await refusal(createEvaluator("Four"));

        expect((error as TRPCError).code).toBe("FORBIDDEN");
        expect(((error as TRPCError).cause as LimitExceededError).meta).toEqual(
          { limitType: "evaluators", current: 3, max: 3 },
        );
      });
    });
  });

  describe("given the organization is on the cloud Free plan with 3 custom evaluators", () => {
    describe("when a member copies one into another project", () => {
      /** @scenario Copying a custom evaluator past the cap is refused with the limit shape */
      it("refuses as FORBIDDEN with limit type, current and max", async () => {
        const created = [];
        for (const name of ["One", "Two", "Three"]) {
          created.push(await createEvaluator(name));
        }

        const error = await refusal(
          caller.evaluators.copy({
            evaluatorId: created[0]!.id,
            sourceProjectId: projectId,
            projectId: otherProjectId,
          }),
        );

        expect((error as TRPCError).code).toBe("FORBIDDEN");
        expect(((error as TRPCError).cause as LimitExceededError).meta).toEqual(
          { limitType: "evaluators", current: 3, max: 3 },
        );
        expect(
          await prisma.evaluator.count({
            where: { projectId: otherProjectId },
          }),
        ).toBe(0);
      });
    });
  });

  describe("given the organization is on the cloud Free plan with 3 scenarios", () => {
    describe("when a member duplicates one", () => {
      /** @scenario Duplicating a scenario past the cap is refused with the limit shape */
      it("refuses as FORBIDDEN and writes nothing", async () => {
        const created = [];
        for (const name of ["One", "Two", "Three"]) {
          created.push(await createScenario(name));
        }

        const error = await refusal(
          caller.scenarios.duplicate({
            projectId,
            scenarioId: created[0]!.id,
          }),
        );

        expect((error as TRPCError).code).toBe("FORBIDDEN");
        expect(((error as TRPCError).cause as LimitExceededError).meta).toEqual(
          { limitType: "scenarios", current: 3, max: 3 },
        );
        expect(
          await prisma.scenario.count({
            where: { projectId, archivedAt: null },
          }),
        ).toBe(3);
      });
    });
  });

  describe("given the organization is on the cloud Free plan with 3 custom evaluators", () => {
    describe("when a member saves a workflow as an evaluator", () => {
      /** @scenario Saving a workflow as a fourth custom evaluator is refused with the limit shape */
      it("refuses before flagging the workflow", async () => {
        for (const name of ["One", "Two", "Three"]) {
          await createEvaluator(name);
        }
        const workflow = await prisma.workflow.create({
          data: {
            id: `workflow_${nanoid()}`,
            projectId,
            name: "Tone judge",
            icon: "🧪",
            description: "",
          },
        });

        const error = await refusal(
          caller.optimization.toggleSaveAsEvaluator({
            projectId,
            workflowId: workflow.id,
            isEvaluator: true,
            isComponent: false,
          }),
        );

        expect((error as TRPCError).code).toBe("FORBIDDEN");
        expect(((error as TRPCError).cause as LimitExceededError).meta).toEqual(
          { limitType: "evaluators", current: 3, max: 3 },
        );
        const after = await prisma.workflow.findFirst({
          where: { id: workflow.id, projectId },
        });
        expect(after?.isEvaluator).toBe(false);
      });
    });
  });

  describe("given the organization is on a paid cloud plan", () => {
    describe("when it already has 3 scenarios and 3 custom evaluators", () => {
      it("creates a fourth of each", async () => {
        plan.current = PLAN_LIMITS[PlanTypes.LAUNCH];
        for (const name of ["One", "Two", "Three", "Four"]) {
          await createScenario(name);
          await createEvaluator(name);
        }

        expect(
          await prisma.scenario.count({
            where: { projectId, archivedAt: null },
          }),
        ).toBe(4);
        expect(
          await prisma.evaluator.count({
            where: { projectId, archivedAt: null },
          }),
        ).toBe(4);
      });
    });
  });
});
