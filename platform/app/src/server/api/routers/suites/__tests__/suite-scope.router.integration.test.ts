/**
 * @vitest-environment node
 *
 * The scope a run plan carries, over the tRPC surface: what the input accepts,
 * what it refuses, and that a plan of one project never reads another's.
 *
 * @see specs/suites/run-plan-dynamic-scopes.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { prisma } from "../../../../db";
import { appRouter } from "../../../root";
import { createInnerTRPCContext } from "../../../trpc";

wireDefaultTestApp();

describe("the scope of a run plan over tRPC", () => {
  const ns = `suite-scope-router-${nanoid(8)}`;
  let projectId: string;
  let otherProjectId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let organizationId: string;
  let teamId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Scope Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: {
        name: "Scope Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: "Scope Project",
        slug: `--test-project-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;
    const otherProject = await prisma.project.create({
      data: {
        name: "Other Scope Project",
        slug: `--test-project-b-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    otherProjectId = otherProject.id;

    const admin = await prisma.user.create({
      data: { name: "Admin", email: `admin-${ns}@example.com` },
    });
    userIds.push(admin.id);
    await prisma.organizationUser.create({
      data: {
        userId: admin.id,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId: admin.id, teamId: team.id, role: TeamUserRole.ADMIN },
    });
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: admin.id }, expires: "1" },
      }),
    );
  });

  beforeEach(() =>
    cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId: { in: [projectId, otherProjectId] } }],
      ["scenario", { projectId: { in: [projectId, otherProjectId] } }],
      ["simulationSuite", { projectId: { in: [projectId, otherProjectId] } }],
    ]),
  );

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId: { in: [projectId, otherProjectId] } }],
      ["scenario", { projectId: { in: [projectId, otherProjectId] } }],
      ["simulationSuite", { projectId: { in: [projectId, otherProjectId] } }],
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["teamUser", { teamId }],
      ["organizationUser", { organizationId }],
      ["team", { id: teamId }],
      ["user", { id: { in: userIds } }],
      ["organization", { id: organizationId }],
    ]),
  );

  describe("when the plan covers a rule", () => {
    /** @scenario "A plan scoped to all test cases runs every active case" */
    it("is created with no test case named", async () => {
      const plan = await caller.suites.create({
        projectId,
        name: `Everything ${nanoid(6)}`,
        scenarioIds: [],
        scope: { mode: "all" },
        targets: [],
        repeatCount: 1,
        labels: [],
      });

      expect(plan.scope).toEqual({ mode: "all" });
      expect(plan.scenarioIds).toEqual([]);
    });

    /** @scenario "A plan scoped to labels runs the cases carrying them" */
    it("takes a new rule on update", async () => {
      const plan = await caller.suites.create({
        projectId,
        name: `Everything ${nanoid(6)}`,
        scenarioIds: [],
        scope: { mode: "all" },
        targets: [],
        repeatCount: 1,
        labels: [],
      });

      const updated = await caller.suites.update({
        projectId,
        id: plan.id,
        scope: { mode: "labels", labels: ["checkout"] },
      });

      expect(updated.scope).toEqual({ mode: "labels", labels: ["checkout"] });
    });

    /** @scenario "The stored shape of every mode is known" */
    it("refuses a mode it does not know", async () => {
      await expect(
        caller.suites.create({
          projectId,
          name: `Broken ${nanoid(6)}`,
          scenarioIds: [],
          // The union is the only definition of the shape, so an invented
          // mode is refused at the door rather than stored and ignored.
          scope: { mode: "everything" } as never,
          targets: [],
          repeatCount: 1,
          labels: [],
        }),
      ).rejects.toThrow();
    });
  });

  describe("when the plan names its test cases", () => {
    /** @scenario "A plan scoped to a hand-picked list runs exactly that list" */
    it("refuses a plan that names none", async () => {
      await expect(
        caller.suites.create({
          projectId,
          name: `Empty ${nanoid(6)}`,
          scenarioIds: [],
          scope: { mode: "cases" },
          targets: [],
          repeatCount: 1,
          labels: [],
        }),
      ).rejects.toThrow();
    });
  });

  describe("when the plan belongs to another project", () => {
    /** @scenario "A scope cannot name another project's test suite" */
    it("is not reachable from this project", async () => {
      const foreign = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId: otherProjectId,
          name: "Foreign plan",
          slug: `foreign-${nanoid(6)}`,
          scenarioIds: [],
          scope: { mode: "all" },
          targets: [],
          labels: [],
        },
      });

      await expect(
        caller.suites.update({
          projectId,
          id: foreign.id,
          scope: { mode: "labels", labels: ["checkout"] },
        }),
      ).rejects.toMatchObject({ cause: { code: "suite_not_found" } });

      const unchanged = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: foreign.id, projectId: otherProjectId },
      });
      expect(unchanged.scope).toEqual({ mode: "all" });
    });
  });

  describe("when the suite is a test suite folder", () => {
    /** @scenario "A test suite refuses a scope" */
    it("refuses the scope and keeps none", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: `Refunds ${nanoid(4)}`,
      });

      await expect(
        caller.suites.update({
          projectId,
          id: folder.id,
          scope: { mode: "all" },
        }),
      ).rejects.toMatchObject({ cause: { code: "suite_scope_not_allowed" } });

      const stored = await prisma.simulationSuite.findFirstOrThrow({
        where: { id: folder.id, projectId },
      });
      expect(stored.scope).toBeNull();
    });
  });
});
