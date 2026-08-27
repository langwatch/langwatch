/**
 * @vitest-environment node
 *
 * The scenarios version tRPC surface against a real database with real RBAC
 * role bindings: who may read history, who may save and restore, and what a
 * caller from another project is told.
 *
 * @see specs/scenarios/scenario-versioning.feature
 * @see specs/scenarios/scenario-version-restore.feature
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

describe("scenarios version procedures", () => {
  const ns = `version-router-${nanoid(8)}`;
  let projectId: string;
  let otherProjectId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let viewerCaller: ReturnType<typeof appRouter.createCaller>;
  let editorId: string;
  let organizationId: string;
  let teamId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Version Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: {
        name: "Version Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: "Version Project",
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

    const editor = await prisma.user.create({
      data: { name: "Lena Fischer", email: `editor-${ns}@example.com` },
    });
    editorId = editor.id;
    userIds.push(editor.id);
    await prisma.organizationUser.create({
      data: {
        userId: editor.id,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId: editor.id, teamId: team.id, role: TeamUserRole.ADMIN },
    });
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: editor.id }, expires: "1" },
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

  // A case created with no suite named is filed into the project's Default
  // suite, which is created on that first write. The suite rows go with the
  // cases, or the project delete below is refused by the relation to them.
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

  async function createCase() {
    return caller.scenarios.create({
      projectId,
      name: "Refund flow",
      situation: "A customer asks for a refund",
      criteria: ["The agent helps"],
      labels: [],
    });
  }

  describe("reading history", () => {
    /** @scenario "A history entry names the number, the author, the date and the changed fields" */
    it("names the number, the author, the date and the changed fields", async () => {
      const scenario = await createCase();
      await caller.scenarios.update({
        projectId,
        id: scenario.id,
        name: "Replacement flow",
        criteria: ["The agent replaces the item"],
      });

      const { versions } = await caller.scenarios.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions[0]).toMatchObject({
        version: 2,
        authorName: "Lena Fischer",
        authorId: editorId,
        changedFields: ["name", "criteria"],
      });
      expect(versions[0]?.createdAt).toBeInstanceOf(Date);
    });

    /** @scenario "A viewer can read version history but cannot save" */
    it("lets a viewer read every version but refuses their save", async () => {
      const scenario = await createCase();
      await caller.scenarios.update({
        projectId,
        id: scenario.id,
        situation: "Edited once",
      });

      const { versions } = await viewerCaller.scenarios.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions.map((v) => v.version)).toEqual([2, 1]);

      await expect(
        viewerCaller.scenarios.update({
          projectId,
          id: scenario.id,
          situation: "A viewer's save",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /** @scenario "Version history of a case in another project is not readable" */
    it("answers not found for a case of another project", async () => {
      const scenario = await createCase();

      await expect(
        caller.scenarios.listVersions({
          projectId: otherProjectId,
          scenarioId: scenario.id,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("serves one version with its stored content", async () => {
      const scenario = await createCase();
      await caller.scenarios.update({
        projectId,
        id: scenario.id,
        situation: "Edited once",
      });

      const version = await caller.scenarios.getVersion({
        projectId,
        scenarioId: scenario.id,
        version: 1,
      });
      expect(version.fields.situation).toBe("A customer asks for a refund");

      await expect(
        caller.scenarios.getVersion({
          projectId,
          scenarioId: scenario.id,
          version: 9,
        }),
      ).rejects.toMatchObject({
        cause: { code: "scenario_version_not_found" },
      });
    });
  });

  describe("stale saves through the editor surface", () => {
    /** @scenario "Saving over a version somebody else already replaced is refused with scenario_stale_version" */
    it("refuses a save that names a replaced version with scenario_stale_version", async () => {
      const scenario = await createCase();
      await caller.scenarios.update({
        projectId,
        id: scenario.id,
        situation: "somebody else's save",
      });

      await expect(
        caller.scenarios.update({
          projectId,
          id: scenario.id,
          situation: "the stale editor's save",
          expectedVersion: 1,
        }),
      ).rejects.toMatchObject({
        cause: { code: "scenario_stale_version" },
      });

      const stored = await caller.scenarios.getById({
        projectId,
        id: scenario.id,
      });
      expect(stored.situation).toBe("somebody else's save");
      expect(stored.version).toBe(2);
    });
  });

  describe("restore", () => {
    it("restores through the surface and lists the restore as the newest entry", async () => {
      const scenario = await createCase();
      await caller.scenarios.update({
        projectId,
        id: scenario.id,
        situation: "Edited once",
      });

      await caller.scenarios.restoreVersion({
        projectId,
        scenarioId: scenario.id,
        version: 1,
      });

      const stored = await caller.scenarios.getById({
        projectId,
        id: scenario.id,
      });
      expect(stored.version).toBe(3);
      expect(stored.situation).toBe("A customer asks for a refund");

      const { versions } = await caller.scenarios.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions[0]).toMatchObject({
        version: 3,
        changeDescription: "Restored from v1",
        authorName: "Lena Fischer",
      });
    });

    /** @scenario "A viewer cannot restore a version" */
    it("refuses a viewer's restore and leaves the case unchanged", async () => {
      const scenario = await createCase();
      await caller.scenarios.update({
        projectId,
        id: scenario.id,
        situation: "Edited once",
      });

      await expect(
        viewerCaller.scenarios.restoreVersion({
          projectId,
          scenarioId: scenario.id,
          version: 1,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const stored = await caller.scenarios.getById({
        projectId,
        id: scenario.id,
      });
      expect(stored.version).toBe(2);
      expect(stored.situation).toBe("Edited once");
    });
  });
});
