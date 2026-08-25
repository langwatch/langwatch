/**
 * @vitest-environment node
 *
 * Coding-agent onboarding provisions the signer's personal workspace.
 *
 * That workspace is where a person's coding-agent usage lands, and the
 * governance track ends on /me, which reads it. Waiting for the first CLI
 * login meant the page the track lands on had nothing to show.
 *
 * The other half is the reason this waited: a personal workspace used to
 * spend a project and a team out of the free plan's allowance of two and one,
 * so provisioning one at signup put a free customer at the ceiling before
 * they created anything. The plan-count assertions here are what keep that
 * from coming back.
 *
 * Hits real Postgres through the real router and the real
 * PersonalWorkspaceService. Requires: PostgreSQL database (Prisma).
 *
 * Spec: specs/features/onboarding/intent-fork.feature
 *       specs/ai-governance/personal-portal/default-catalog.feature
 */
import { STARTER_PACK_TILES } from "@ee/governance/services/aiToolEntry.service";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getApp, globalForApp, resetApp } from "~/server/app-layer/app";
import { OrganizationService } from "~/server/app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "~/server/app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "~/server/app-layer/presets";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { createInnerTRPCContext } from "../../../trpc";
import { onboardingRouter } from "../onboarding.router";

const suffix = nanoid(8);

/** Users created here, torn down with everything hanging off them. */
const createdUserIds: string[] = [];
const createdOrganizationIds: string[] = [];

async function seedUser(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `Onboarding ${label}`,
      email: `onboarding-${label}-${suffix}@example.com`,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function callerFor(user: {
  id: string;
  name: string | null;
  email: string | null;
}) {
  return onboardingRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: user.id, name: user.name, email: user.email },
        expires: "1",
      },
      permissionChecked: false,
    }) as never,
  );
}

async function personalWorkspaceOf({
  userId,
  organizationId,
}: {
  userId: string;
  organizationId: string;
}) {
  return await prisma.team.findFirst({
    where: { organizationId, ownerUserId: userId, isPersonal: true },
    include: { projects: true },
  });
}

describe("onboarding.initializeOrganization personal workspace", () => {
  beforeAll(async () => {
    // The router creates the organization through `getApp().organizations`,
    // so the App singleton needs a real Prisma repository. Same shape as
    // rbac.member-leak-coverage.integration.test.ts — createTestApp with one
    // real repo, avoiding initializeDefaultApp's require() chain.
    await resetApp();
    globalForApp.__langwatch_app = createTestApp({
      organizations: new OrganizationService(
        new PrismaOrganizationRepository(prisma),
        {
          seedTagsForOrganization: async () => {
            /* noop */
          },
        },
      ),
    });
  });

  afterAll(async () => {
    for (const organizationId of createdOrganizationIds) {
      // ProjectSecret's relation to Project is required, so it has to go
      // before the projects it belongs to. Project-level models are filtered
      // by projectId, which the multitenancy middleware insists on.
      const projects = await prisma.project.findMany({
        where: { team: { organizationId } },
        select: { id: true },
      });
      const projectIds = projects.map((project) => project.id);
      if (projectIds.length > 0) {
        await prisma.projectSecret.deleteMany({
          where: { projectId: { in: projectIds } },
        });
      }
      await cleanupTestRows(prisma, [
        ["project", { team: { organizationId } }],
        ["aiToolEntry", { organizationId }],
        ["roleBinding", { organizationId }],
        ["teamUser", { team: { organizationId } }],
        ["team", { organizationId }],
        ["organizationUser", { organizationId }],
        ["organization", { id: organizationId }],
      ]);
    }
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await resetApp();
  });

  describe("given the user picked the coding-agent tracking intent", () => {
    let userId: string;
    let organizationId: string;

    beforeAll(async () => {
      const user = await seedUser("governance");
      userId = user.id;

      const result = await callerFor(user).initializeOrganization({
        orgName: `ACME Governance ${suffix}`,
        primaryIntent: "AGENT_GOVERNANCE",
        language: "other",
        framework: "other",
      });

      organizationId = result.organizationId;
      createdOrganizationIds.push(organizationId);
    });

    /** @scenario Governance signup provisions the personal workspace */
    it("provisions a personal workspace owned by the signer", async () => {
      const workspace = await personalWorkspaceOf({ userId, organizationId });

      expect(workspace).not.toBeNull();
      expect(workspace!.projects).toHaveLength(1);
      expect(workspace!.projects[0]!.isPersonal).toBe(true);
      expect(workspace!.projects[0]!.ownerUserId).toBe(userId);
    });

    /** @scenario Governance signup creates organization and team, but no shared project */
    it("creates no shared project", async () => {
      const sharedProjects = await prisma.project.findMany({
        where: { team: { organizationId }, isPersonal: false },
      });

      expect(sharedProjects).toHaveLength(0);
    });

    /** @scenario The personal workspace stays separate from the shared workspace */
    it("keeps the personal team distinct from the organization's shared team", async () => {
      const allTeams = await prisma.team.count({ where: { organizationId } });
      const personalTeams = await prisma.team.count({
        where: { organizationId, isPersonal: true },
      });

      // Two teams exist, the organization's own and the personal one.
      expect(allTeams).toBe(2);
      expect(personalTeams).toBe(1);
    });

    /** @scenario A fresh organization gets the full standard catalog with no admin action */
    it("provisions the standard AI tool catalog", async () => {
      const tiles = await prisma.aiToolEntry.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      });

      expect(tiles.map((t) => t.slug)).toEqual(
        STARTER_PACK_TILES.map((t) => t.slug),
      );
      expect(tiles.every((t) => t.enabled && t.archivedAt === null)).toBe(true);
    });

    /** @scenario The personal workspace stays separate from the shared workspace */
    it("is idempotent, so a later CLI login adds no second workspace", async () => {
      const again = await getApp().organizations.ensurePersonalWorkspace({
        userId,
        organizationId,
      });

      expect(again.created).toBe(false);
      expect(
        await prisma.team.count({
          where: { organizationId, isPersonal: true },
        }),
      ).toBe(1);
    });
  });

  describe("given the user picked the LLM-app intent", () => {
    let userId: string;
    let organizationId: string;

    beforeAll(async () => {
      const user = await seedUser("llmops");
      userId = user.id;

      const result = await callerFor(user).initializeOrganization({
        orgName: `ACME LLMOps ${suffix}`,
        primaryIntent: "LLM_OPS",
        language: "other",
        framework: "other",
      });

      organizationId = result.organizationId;
      createdOrganizationIds.push(organizationId);
    });

    /** @scenario LLMOps signup provisions no personal workspace */
    it("provisions no personal workspace", async () => {
      const workspace = await personalWorkspaceOf({ userId, organizationId });

      expect(workspace).toBeNull();
    });

    /** @scenario LLMOps signup still creates the default project */
    it("still creates the default project", async () => {
      const sharedProjects = await prisma.project.findMany({
        where: { team: { organizationId }, isPersonal: false },
      });

      expect(sharedProjects).toHaveLength(1);
    });

    /** @scenario A fresh organization gets the full standard catalog with no admin action */
    it("provisions the standard AI tool catalog for this intent too", async () => {
      // The catalog is intent-independent: whichever door the org came in
      // through, its members' /me portal must render tiles, not the
      // empty state.
      const tiles = await prisma.aiToolEntry.findMany({
        where: { organizationId },
        orderBy: { order: "asc" },
      });

      expect(tiles.map((t) => t.slug)).toEqual(
        STARTER_PACK_TILES.map((t) => t.slug),
      );
      expect(tiles.every((t) => t.enabled && t.archivedAt === null)).toBe(true);
    });
  });
});
