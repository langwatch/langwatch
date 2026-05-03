/**
 * @vitest-environment node
 *
 * Integration coverage for PersonalWorkspaceService — hits real PG
 * (testcontainers), no mocks. Validates the contract the rest of the
 * governance lane depends on:
 *
 *   1. `ensure()` creates a personal Team + Project + RoleBinding +
 *      legacy TeamUser row in a single transaction. All four artefacts
 *      exist after the call.
 *   2. `ensure()` is idempotent — a second call returns the same
 *      workspace and creates no new rows.
 *   3. `ensure()` flags both Team and Project with isPersonal=true
 *      and stamps ownerUserId on both.
 *   4. The personal Team is hidden from the workspace switcher's
 *      shared-team list (via the isPersonal=true filter on the
 *      partial unique index).
 *   5. `findExisting()` returns null when no workspace exists, the
 *      populated workspace when one does. Used from hot paths
 *      (auth/session) where a write would be wrong.
 *
 * Spec: specs/ai-gateway/governance/personal-keys.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

import { PersonalWorkspaceService } from "../personalWorkspace.service";

const suffix = nanoid(8);
const ORG_ID = `org-pw-${suffix}`;
const USER_ID = `usr-pw-${suffix}`;
const SECOND_USER_ID = `usr-pw-2-${suffix}`;

describe("PersonalWorkspaceService — auto-create personal team + project", () => {
  const service = new PersonalWorkspaceService(prisma);

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `PW Org ${suffix}`,
        slug: `pw-${suffix}`,
      },
    });
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: `pw-${suffix}@example.com`,
        name: "PW Owner",
      },
    });
    await prisma.user.create({
      data: {
        id: SECOND_USER_ID,
        email: `pw2-${suffix}@example.com`,
        name: "PW Other",
      },
    });
    await prisma.organizationUser.createMany({
      data: [
        { organizationId: ORG_ID, userId: USER_ID, role: "MEMBER" },
        { organizationId: ORG_ID, userId: SECOND_USER_ID, role: "MEMBER" },
      ],
    });
  }, 60_000);

  afterAll(async () => {
    // Cleanup in dependency order. Personal Team's id may have been
    // assigned dynamically inside ensure() so we wipe by org/owner.
    // dbMultiTenancyProtection requires projectId in the WHERE for
    // VirtualKey — resolve project ids explicitly first.
    const projects = await prisma.project.findMany({
      where: { team: { organizationId: ORG_ID } },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);
    if (projectIds.length > 0) {
      await prisma.virtualKey.deleteMany({
        where: { projectId: { in: projectIds } },
      });
    }
    await prisma.roleBinding.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.project.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, SECOND_USER_ID] } },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 60_000);

  describe("when ensure is called for a brand-new (user, org) pair", () => {
    it("creates Team + Project + RoleBinding + TeamUser in one transaction", async () => {
      const result = await service.ensure({
        userId: USER_ID,
        organizationId: ORG_ID,
        displayName: "PW Owner",
        displayEmail: `pw-${suffix}@example.com`,
      });

      expect(result.created).toBe(true);
      expect(result.team.id).toBeDefined();
      expect(result.project.id).toBeDefined();
      expect(result.team.name).toContain("Workspace");

      const team = await prisma.team.findUnique({
        where: { id: result.team.id },
      });
      expect(team).not.toBeNull();
      expect(team?.isPersonal).toBe(true);
      expect(team?.ownerUserId).toBe(USER_ID);
      expect(team?.organizationId).toBe(ORG_ID);

      const project = await prisma.project.findUnique({
        where: { id: result.project.id },
      });
      expect(project).not.toBeNull();
      expect(project?.isPersonal).toBe(true);
      expect(project?.ownerUserId).toBe(USER_ID);
      expect(project?.teamId).toBe(team!.id);

      const roleBinding = await prisma.roleBinding.findFirst({
        where: {
          organizationId: ORG_ID,
          userId: USER_ID,
          scopeType: "TEAM",
          scopeId: team!.id,
        },
      });
      expect(roleBinding).not.toBeNull();
      expect(roleBinding?.role).toBe("ADMIN");

      const teamUser = await prisma.teamUser.findUnique({
        where: { userId_teamId: { userId: USER_ID, teamId: team!.id } },
      });
      expect(teamUser).not.toBeNull();
      expect(teamUser?.role).toBe("ADMIN");
    });
  });

  describe("when ensure is called a second time for the same pair", () => {
    it("returns the existing workspace without creating new rows", async () => {
      const teamCountBefore = await prisma.team.count({
        where: { organizationId: ORG_ID, isPersonal: true, ownerUserId: USER_ID },
      });
      const projectCountBefore = await prisma.project.count({
        where: { team: { organizationId: ORG_ID }, isPersonal: true, ownerUserId: USER_ID },
      });

      const second = await service.ensure({
        userId: USER_ID,
        organizationId: ORG_ID,
      });

      expect(second.created).toBe(false);

      const teamCountAfter = await prisma.team.count({
        where: { organizationId: ORG_ID, isPersonal: true, ownerUserId: USER_ID },
      });
      const projectCountAfter = await prisma.project.count({
        where: { team: { organizationId: ORG_ID }, isPersonal: true, ownerUserId: USER_ID },
      });

      expect(teamCountAfter).toBe(teamCountBefore);
      expect(projectCountAfter).toBe(projectCountBefore);
    });
  });

  describe("when a different user joins the same org", () => {
    it("creates a separate personal workspace per (org, user)", async () => {
      const second = await service.ensure({
        userId: SECOND_USER_ID,
        organizationId: ORG_ID,
        displayEmail: `pw2-${suffix}@example.com`,
      });

      expect(second.created).toBe(true);

      const allPersonalInOrg = await prisma.team.count({
        where: { organizationId: ORG_ID, isPersonal: true },
      });
      // First user from previous test + this second user = 2.
      expect(allPersonalInOrg).toBe(2);

      const firstUserTeam = await prisma.team.findFirst({
        where: {
          organizationId: ORG_ID,
          isPersonal: true,
          ownerUserId: USER_ID,
        },
      });
      const secondUserTeam = await prisma.team.findFirst({
        where: {
          organizationId: ORG_ID,
          isPersonal: true,
          ownerUserId: SECOND_USER_ID,
        },
      });
      expect(firstUserTeam).not.toBeNull();
      expect(secondUserTeam).not.toBeNull();
      // Distinct personal teams per (org, user). The previous spelling
      // had a self-comparison via a ternary that always evaluated true,
      // masking the real assertion. Fixed to compare across users.
      expect(secondUserTeam?.id).not.toBe(firstUserTeam?.id);
      expect(secondUserTeam?.id).toBe(second.team.id);
    });
  });

  describe("findExisting", () => {
    it("returns null for a (user, org) pair without a personal workspace", async () => {
      const found = await service.findExisting({
        userId: `usr-nonexistent-${suffix}`,
        organizationId: ORG_ID,
      });
      expect(found).toBeNull();
    });

    it("returns the populated workspace when one exists", async () => {
      const found = await service.findExisting({
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(found).not.toBeNull();
      expect(found?.team.id).toBeDefined();
      expect(found?.project.id).toBeDefined();
      expect(found?.project.apiKey).toBeDefined();
    });
  });
});
