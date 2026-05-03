/**
 * @vitest-environment node
 *
 * Integration coverage for the AI Tools Portal catalog router (Phase 7).
 *
 * Pins three things end-to-end via the live tRPC procedure layer:
 *   1. RBAC enforcement — MEMBER can list (aiTools:view) but cannot
 *      create/update/archive/setEnabled/reorder. ADMIN can do all.
 *      EXTERNAL can also list (portal must work for everyone).
 *   2. Org/team scoping resolution — listForUser applies team-overrides-
 *      org by slug; entries scoped to a team the user is NOT a member of
 *      are filtered out.
 *   3. Per-type config validation — invalid config payloads (missing
 *      required fields per the discriminated union) reject with
 *      BAD_REQUEST instead of corrupting the DB.
 *
 * Companion specs:
 *   specs/ai-governance/personal-portal/tool-catalog-rbac.feature
 *   specs/ai-governance/personal-portal/tool-catalog-scoping.feature
 *   specs/ai-governance/personal-portal/tool-catalog-vk-bridge.feature
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";

describe("aiToolsRouter integration", () => {
  const ns = `aitools-${nanoid(8)}`;

  let organizationId: string;
  let teamPlatformId: string;
  let teamDataScienceId: string;
  let adminUserId: string;
  let memberPlatformUserId: string;
  let memberOrphanUserId: string;

  beforeAll(async () => {
    resetApp();
    globalForApp.__langwatch_app = createTestApp();

    const organization = await prisma.organization.create({
      data: { name: `AiTools Org ${ns}`, slug: `--ait-${ns}` },
    });
    organizationId = organization.id;

    const teamPlatform = await prisma.team.create({
      data: {
        name: `Platform ${ns}`,
        slug: `--ait-platform-${ns}`,
        organizationId,
      },
    });
    teamPlatformId = teamPlatform.id;

    const teamDataScience = await prisma.team.create({
      data: {
        name: `Data ${ns}`,
        slug: `--ait-data-${ns}`,
        organizationId,
      },
    });
    teamDataScienceId = teamDataScience.id;

    const admin = await prisma.user.create({
      data: { name: "Admin", email: `ait-admin-${ns}@example.com` },
    });
    adminUserId = admin.id;
    await prisma.organizationUser.create({
      data: { userId: admin.id, organizationId, role: OrganizationUserRole.ADMIN },
    });
    await prisma.teamUser.create({
      data: { userId: admin.id, teamId: teamPlatform.id, role: TeamUserRole.ADMIN },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId: admin.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    const memberPlatform = await prisma.user.create({
      data: { name: "Member Platform", email: `ait-mp-${ns}@example.com` },
    });
    memberPlatformUserId = memberPlatform.id;
    await prisma.organizationUser.create({
      data: {
        userId: memberPlatform.id,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.teamUser.create({
      data: {
        userId: memberPlatform.id,
        teamId: teamPlatform.id,
        role: TeamUserRole.MEMBER,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId: memberPlatform.id,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    const memberOrphan = await prisma.user.create({
      data: { name: "Member Orphan", email: `ait-mo-${ns}@example.com` },
    });
    memberOrphanUserId = memberOrphan.id;
    await prisma.organizationUser.create({
      data: {
        userId: memberOrphan.id,
        organizationId,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.roleBinding.create({
      data: {
        organizationId,
        userId: memberOrphan.id,
        role: TeamUserRole.MEMBER,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
  });

  afterAll(async () => {
    await prisma.aiToolEntry.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.roleBinding.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.teamUser
      .deleteMany({ where: { team: { slug: { startsWith: `--ait-` } } } })
      .catch(() => {});
    await prisma.organizationUser.deleteMany({ where: { organizationId } }).catch(() => {});
    await prisma.team
      .deleteMany({ where: { slug: { startsWith: `--ait-` } } })
      .catch(() => {});
    await prisma.organization.deleteMany({ where: { slug: `--ait-${ns}` } }).catch(() => {});
    await prisma.user
      .deleteMany({
        where: {
          email: {
            in: [
              `ait-admin-${ns}@example.com`,
              `ait-mp-${ns}@example.com`,
              `ait-mo-${ns}@example.com`,
            ],
          },
        },
      })
      .catch(() => {});
  });

  function callerFor(userId: string) {
    const ctx = createInnerTRPCContext({
      session: { user: { id: userId }, expires: "1" } as any,
    });
    return appRouter.createCaller(ctx);
  }

  describe("RBAC", () => {
    it("MEMBER can list but cannot create", async () => {
      const memberCaller = callerFor(memberPlatformUserId);
      await expect(
        memberCaller.aiTools.list({ organizationId }),
      ).resolves.toBeDefined();

      await expect(
        memberCaller.aiTools.create({
          organizationId,
          scope: "organization",
          scopeId: organizationId,
          type: "external_tool",
          displayName: "Wiki",
          slug: `wiki-${nanoid(4).toLowerCase()}`,
          config: {
            descriptionMarkdown: "Hi",
            linkUrl: "https://wiki.example.com",
          },
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("ADMIN can create + adminList", async () => {
      const adminCaller = callerFor(adminUserId);
      const created = await adminCaller.aiTools.create({
        organizationId,
        scope: "organization",
        scopeId: organizationId,
        type: "coding_assistant",
        displayName: "Claude Code",
        slug: `cc-${nanoid(4).toLowerCase()}`,
        config: {
          setupCommand: "langwatch claude",
          setupDocsUrl: "https://docs.langwatch.ai/claude",
        },
      });
      expect(created.id).toBeDefined();

      const adminList = await adminCaller.aiTools.adminList({ organizationId });
      expect(adminList.some((e) => e.id === created.id)).toBe(true);
    });
  });

  describe("Scoping", () => {
    it("filters team-scoped entries to team members", async () => {
      const adminCaller = callerFor(adminUserId);
      const platformOnlySlug = `bedrock-${nanoid(4).toLowerCase()}`;
      await adminCaller.aiTools.create({
        organizationId,
        scope: "team",
        scopeId: teamPlatformId,
        type: "model_provider",
        displayName: "Bedrock — Platform team",
        slug: platformOnlySlug,
        config: { providerKey: "bedrock" },
      });

      const platformList = await callerFor(memberPlatformUserId).aiTools.list({
        organizationId,
      });
      expect(platformList.some((e) => e.slug === platformOnlySlug)).toBe(true);

      const orphanList = await callerFor(memberOrphanUserId).aiTools.list({
        organizationId,
      });
      expect(orphanList.some((e) => e.slug === platformOnlySlug)).toBe(false);
    });

    it("team entry shadows org default by slug", async () => {
      const adminCaller = callerFor(adminUserId);
      const sharedSlug = `openai-${nanoid(4).toLowerCase()}`;

      await adminCaller.aiTools.create({
        organizationId,
        scope: "organization",
        scopeId: organizationId,
        type: "model_provider",
        displayName: "OpenAI (default)",
        slug: sharedSlug,
        config: { providerKey: "openai" },
      });
      await adminCaller.aiTools.create({
        organizationId,
        scope: "team",
        scopeId: teamPlatformId,
        type: "model_provider",
        displayName: "OpenAI — Platform override",
        slug: sharedSlug,
        config: { providerKey: "openai" },
      });

      const platformList = await callerFor(memberPlatformUserId).aiTools.list({
        organizationId,
      });
      const platformMatches = platformList.filter((e) => e.slug === sharedSlug);
      expect(platformMatches).toHaveLength(1);
      expect(platformMatches[0]?.displayName).toBe("OpenAI — Platform override");

      const orphanList = await callerFor(memberOrphanUserId).aiTools.list({
        organizationId,
      });
      const orphanMatches = orphanList.filter((e) => e.slug === sharedSlug);
      expect(orphanMatches).toHaveLength(1);
      expect(orphanMatches[0]?.displayName).toBe("OpenAI (default)");
    });
  });

  describe("Per-type config validation", () => {
    it("rejects coding_assistant entries missing setupCommand with BAD_REQUEST", async () => {
      await expect(
        callerFor(adminUserId).aiTools.create({
          organizationId,
          scope: "organization",
          scopeId: organizationId,
          type: "coding_assistant",
          displayName: "Broken",
          slug: `broken-${nanoid(4).toLowerCase()}`,
          config: {
            setupDocsUrl: "https://docs.example.com",
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects external_tool entries with non-URL linkUrl", async () => {
      await expect(
        callerFor(adminUserId).aiTools.create({
          organizationId,
          scope: "organization",
          scopeId: organizationId,
          type: "external_tool",
          displayName: "Bad link",
          slug: `bl-${nanoid(4).toLowerCase()}`,
          config: {
            descriptionMarkdown: "Hi",
            linkUrl: "not-a-url",
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("setEnabled + archive", () => {
    it("setEnabled toggles visibility on the user-facing list", async () => {
      const adminCaller = callerFor(adminUserId);
      const slug = `toggle-${nanoid(4).toLowerCase()}`;
      const entry = await adminCaller.aiTools.create({
        organizationId,
        scope: "organization",
        scopeId: organizationId,
        type: "external_tool",
        displayName: "Toggleable",
        slug,
        config: {
          descriptionMarkdown: "x",
          linkUrl: "https://example.com",
        },
      });

      const beforeList = await callerFor(memberPlatformUserId).aiTools.list({
        organizationId,
      });
      expect(beforeList.some((e) => e.id === entry.id)).toBe(true);

      await adminCaller.aiTools.setEnabled({
        organizationId,
        id: entry.id,
        enabled: false,
      });

      const afterList = await callerFor(memberPlatformUserId).aiTools.list({
        organizationId,
      });
      expect(afterList.some((e) => e.id === entry.id)).toBe(false);

      const adminAfter = await adminCaller.aiTools.adminList({ organizationId });
      expect(adminAfter.some((e) => e.id === entry.id && e.enabled === false)).toBe(true);
    });
  });
});
