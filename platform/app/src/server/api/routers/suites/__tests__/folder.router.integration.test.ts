/**
 * @vitest-environment node
 *
 * The suites.folders tRPC surface and the v1 kind guard, against a real
 * database with real RBAC role bindings.
 *
 * @see specs/suites/suite-folders.feature
 * @see specs/suites/folder-run-plan-reuse.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
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

describe("suites.folders integration", () => {
  const ns = `folder-router-${nanoid(8)}`;
  let projectId: string;
  let otherProjectId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let viewerCaller: ReturnType<typeof appRouter.createCaller>;
  let organizationId: string;
  let teamId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Folder Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: {
        name: "Folder Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: "Folder Project",
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
        name: "Other Project",
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

    const viewer = await prisma.user.create({
      data: { name: "Viewer", email: `viewer-${ns}@example.com` },
    });
    userIds.push(viewer.id);
    await prisma.organizationUser.create({
      data: {
        userId: viewer.id,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.teamUser.create({
      data: { userId: viewer.id, teamId: team.id, role: TeamUserRole.VIEWER },
    });
    viewerCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: viewer.id }, expires: "1" },
      }),
    );
  });

  // Creating a case writes its first version, and ScenarioVersion has no
  // foreign key, so those rows outlive the case unless they go first.
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

  async function createCustomPlan(name: string, project = projectId) {
    const scenario = await prisma.scenario.create({
      data: {
        projectId: project,
        name: `${name} case`,
        situation: "A customer asks for help",
        criteria: ["The agent helps"],
        labels: [],
      },
    });
    return prisma.simulationSuite.create({
      data: {
        id: `suite_${nanoid()}`,
        projectId: project,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nanoid(6)}`,
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: "agent_1" }],
        labels: [],
      },
    });
  }

  describe("creating a folder", () => {
    /** @scenario "A new folder is created empty and appears in the rail" */
    it("creates it empty and lists it in folders.getAll", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });

      expect(folder.kind).toBe("folder");
      expect(folder.scenarioIds).toEqual([]);

      const folders = await caller.suites.folders.getAll({ projectId });
      expect(folders.map((f) => f.id)).toContain(folder.id);
      expect(folders.find((f) => f.id === folder.id)?.caseIds).toEqual([]);
    });

    /** @scenario "A folder created with a name another suite already uses keeps both names readable" */
    it("keeps the name readable and takes a different address when a run plan holds the slug", async () => {
      const plan = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId,
          name: "Refunds",
          slug: "refunds",
          scenarioIds: ["scen_x"],
          targets: [{ type: "http", referenceId: "agent_1" }],
          labels: [],
        },
      });

      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });

      expect(folder.name).toBe("Refunds");
      expect(folder.slug).not.toBe(plan.slug);
      expect(folder.slug).toMatch(/^refunds-/);
    });
  });

  describe("renaming a folder", () => {
    /** @scenario "Renaming a folder keeps its cases and its run history" */
    it("changes the name and keeps the slug and the member list", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });
      const scenario = await caller.scenarios.create({
        projectId,
        name: "Refund case",
        situation: "A customer wants a refund",
        criteria: [],
        labels: [],
        folderId: folder.id,
      });

      const renamed = await caller.suites.folders.rename({
        projectId,
        folderId: folder.id,
        name: "Refunds and credits",
      });

      expect(renamed.name).toBe("Refunds and credits");
      // The slug addresses the folder's run history, so a rename keeps it.
      expect(renamed.slug).toBe(folder.slug);
      expect(renamed.scenarioIds).toEqual([scenario.id]);
    });

    /** @scenario "Renaming a folder in another project is refused with suite_not_found" */
    it("refuses a folder of another project with suite_not_found", async () => {
      const foreign = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId: otherProjectId,
          name: "Foreign",
          slug: `foreign-${nanoid(6)}`,
          kind: "folder",
          scenarioIds: [],
          targets: [],
          labels: [],
        },
      });

      await expect(
        caller.suites.folders.rename({
          projectId,
          folderId: foreign.id,
          name: "Taken over",
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "suite_not_found" }),
      });

      const kept = await prisma.simulationSuite.findFirst({
        where: { id: foreign.id, projectId: otherProjectId },
      });
      expect(kept?.name).toBe("Foreign");
    });
  });

  describe("archiving a folder", () => {
    /** @scenario "Archiving a folder archives the cases in it" */
    /** @scenario "Archiving a folder archives its run plan too" */
    it("archives the folder and its cases together", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });
      const first = await caller.scenarios.create({
        projectId,
        name: "One",
        situation: "s",
        criteria: [],
        labels: [],
        folderId: folder.id,
      });
      const second = await caller.scenarios.create({
        projectId,
        name: "Two",
        situation: "s",
        criteria: [],
        labels: [],
        folderId: folder.id,
      });

      await caller.suites.folders.archive({ projectId, folderId: folder.id });

      const folders = await caller.suites.folders.getAll({ projectId });
      expect(folders.map((f) => f.id)).not.toContain(folder.id);

      const cases = await caller.scenarios.getAll({ projectId });
      const listedIds = cases.map((scenario) => scenario.id);
      expect(listedIds).not.toContain(first.id);
      expect(listedIds).not.toContain(second.id);

      // The folder's own suite row is archived too, so no run plan surface
      // lists it any more.
      const archivedRow = await prisma.simulationSuite.findFirst({
        where: { id: folder.id, projectId },
      });
      expect(archivedRow?.archivedAt).not.toBeNull();
    });

    /** @scenario "Archiving a folder that is already archived changes nothing" */
    it("keeps the first archive time on a second archive", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });
      await caller.suites.folders.archive({ projectId, folderId: folder.id });
      const firstArchive = await prisma.simulationSuite.findFirst({
        where: { id: folder.id, projectId },
      });

      await caller.suites.folders.archive({ projectId, folderId: folder.id });

      const secondArchive = await prisma.simulationSuite.findFirst({
        where: { id: folder.id, projectId },
      });
      expect(secondArchive?.archivedAt).toEqual(firstArchive?.archivedAt);
    });
  });

  describe("folder targets", () => {
    /** @scenario "The target chosen for a folder run is offered again next time" */
    it("persists targets set on a folder through suites.update", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });

      await caller.suites.update({
        projectId,
        id: folder.id,
        targets: [{ type: "http", referenceId: "agent_prod" }],
      });

      const folders = await caller.suites.folders.getAll({ projectId });
      expect(folders.find((f) => f.id === folder.id)?.targets).toEqual([
        { type: "http", referenceId: "agent_prod" },
      ]);
    });

    it("refuses a direct scenarioIds write on a folder", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });

      await expect(
        caller.suites.update({
          projectId,
          id: folder.id,
          scenarioIds: ["scen_forged"],
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "validation_error" }),
      });

      const kept = await prisma.simulationSuite.findFirst({
        where: { id: folder.id, projectId },
      });
      expect(kept?.scenarioIds).toEqual([]);
    });
  });

  describe("the v1 kind guard", () => {
    /** @scenario "The v1 run plan list holds no folder rows" */
    it("keeps folder rows out of suites.getAll when no kind is named", async () => {
      await caller.suites.folders.create({ projectId, name: "Refunds" });
      await caller.suites.folders.create({ projectId, name: "Checkout" });
      const plan = await createCustomPlan("Nightly");

      const listed = await caller.suites.getAll({ projectId });

      expect(listed.map((suite) => suite.id)).toEqual([plan.id]);
    });

    /** @scenario "The v2 Test Runs list holds both folders and custom run plans" */
    it("returns folders and custom plans when both kinds are named", async () => {
      const refunds = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });
      const checkout = await caller.suites.folders.create({
        projectId,
        name: "Checkout",
      });
      const plan = await createCustomPlan("Nightly");

      const listed = await caller.suites.getAll({
        projectId,
        kinds: ["folder", "custom"],
      });

      expect(listed.map((suite) => suite.id).sort()).toEqual(
        [refunds.id, checkout.id, plan.id].sort(),
      );
    });
  });

  describe("permissions", () => {
    /** @scenario "A viewer can read folders but cannot create or archive one" */
    it("lets a viewer read folders and refuses their writes", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });

      const seen = await viewerCaller.suites.folders.getAll({ projectId });
      expect(seen.map((f) => f.id)).toContain(folder.id);

      await expect(
        viewerCaller.suites.folders.create({ projectId, name: "Mine" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        viewerCaller.suites.folders.archive({
          projectId,
          folderId: folder.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /** @scenario "A person with read-only access cannot move a case" */
    it("refuses a viewer's move of a case", async () => {
      const folder = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });
      const scenario = await caller.scenarios.create({
        projectId,
        name: "Refund case",
        situation: "s",
        criteria: [],
        labels: [],
      });

      await expect(
        viewerCaller.scenarios.moveToFolder({
          projectId,
          scenarioId: scenario.id,
          folderId: folder.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.folderId).toBeNull();
    });
  });

  describe("moving a case over tRPC", () => {
    /** @scenario "Moving a case from its row menu regroups the case list" */
    /** @scenario "Unfiling a case moves it to the unfiled group" */
    it("moves and unfiles a case, keeping its id and history key", async () => {
      const refunds = await caller.suites.folders.create({
        projectId,
        name: "Refunds",
      });
      const checkout = await caller.suites.folders.create({
        projectId,
        name: "Checkout",
      });
      const scenario = await caller.scenarios.create({
        projectId,
        name: "Refund case",
        situation: "s",
        criteria: [],
        labels: [],
        folderId: refunds.id,
      });

      const moved = await caller.scenarios.moveToFolder({
        projectId,
        scenarioId: scenario.id,
        folderId: checkout.id,
      });
      // Run history keys on the scenario id, which the move never touches.
      expect(moved.id).toBe(scenario.id);
      expect(moved.folderId).toBe(checkout.id);

      const unfiled = await caller.scenarios.moveToFolder({
        projectId,
        scenarioId: scenario.id,
        folderId: null,
      });
      expect(unfiled.folderId).toBeNull();

      const listed = await caller.scenarios.getAll({ projectId });
      expect(listed.map((s) => s.id)).toContain(scenario.id);
    });
  });
});
