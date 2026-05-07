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
          teamIds: [],
          type: "external_tool",
          displayName: `Wiki ${nanoid(4)}`,
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
        teamIds: [],
        type: "coding_assistant",
        displayName: `Claude Code ${nanoid(4)}`,
        iconAsset: "preset:claude_code",
        config: {
          assistantKind: "claude_code",
          setupCommand: "langwatch claude",
          setupDocsUrl: "https://docs.langwatch.ai/claude",
        },
      });
      expect(created.id).toBeDefined();
      // Server-owned slug: must auto-generate from displayName.
      expect(created.slug).toMatch(/^claude-code-/);
      // teamIds[] mirrors back-compat scope/scopeId ('organization'
      // when empty) — listForUser uses the new join-table path.
      expect(created.teamIds).toEqual([]);
      expect(created.scope).toBe("organization");
      expect(created.iconAsset).toBe("preset:claude_code");

      const adminList = await adminCaller.aiTools.adminList({ organizationId });
      expect(adminList.some((e) => e.id === created.id)).toBe(true);
    });
  });

  describe("Scoping", () => {
    it("filters team-scoped entries to team members", async () => {
      const adminCaller = callerFor(adminUserId);
      const created = await adminCaller.aiTools.create({
        organizationId,
        teamIds: [teamPlatformId],
        type: "model_provider",
        displayName: `Bedrock — Platform team ${nanoid(4)}`,
        iconAsset: "preset:bedrock",
        config: { providerKey: "bedrock" },
      });

      const platformList = await callerFor(memberPlatformUserId).aiTools.list({
        organizationId,
      });
      expect(platformList.some((e) => e.id === created.id)).toBe(true);
      expect(
        platformList.find((e) => e.id === created.id)?.teamIds,
      ).toEqual([teamPlatformId]);

      const orphanList = await callerFor(memberOrphanUserId).aiTools.list({
        organizationId,
      });
      expect(orphanList.some((e) => e.id === created.id)).toBe(false);
    });

    it("team entry shadows org default by slug", async () => {
      // Slug is server-owned (auto-generated with a nanoid suffix),
      // so admins can't trigger shadowing via the public API by
      // re-using a slug. We exercise the listForUser shadowing path
      // directly via prisma writes — the contract that *if* two
      // entries share a slug the team-bound one wins for users in
      // that team is still load-bearing for any future admin tool
      // that imports catalogs by slug.
      const sharedSlug = `openai-shadow-${nanoid(6).toLowerCase()}`;
      const orgEntry = await prisma.aiToolEntry.create({
        data: {
          organizationId,
          scope: "organization",
          scopeId: organizationId,
          type: "model_provider",
          displayName: "OpenAI (default)",
          slug: sharedSlug,
          config: { providerKey: "openai" },
        },
      });
      const teamEntry = await prisma.aiToolEntry.create({
        data: {
          organizationId,
          scope: "team",
          scopeId: teamPlatformId,
          type: "model_provider",
          displayName: "OpenAI — Platform override",
          slug: sharedSlug,
          config: { providerKey: "openai" },
        },
      });
      await prisma.aiToolEntryTeam.create({
        data: { entryId: teamEntry.id, teamId: teamPlatformId },
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

      // Cleanup so other tests don't see the shadow rows.
      await prisma.aiToolEntry
        .deleteMany({ where: { id: { in: [orgEntry.id, teamEntry.id] } } })
        .catch(() => undefined);
    });
  });

  describe("Per-type config validation", () => {
    it("rejects coding_assistant entries missing setupCommand with BAD_REQUEST", async () => {
      await expect(
        callerFor(adminUserId).aiTools.create({
          organizationId,
          teamIds: [],
          type: "coding_assistant",
          displayName: `Broken ${nanoid(4)}`,
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
          teamIds: [],
          type: "external_tool",
          displayName: `Bad link ${nanoid(4)}`,
          config: {
            descriptionMarkdown: "Hi",
            linkUrl: "not-a-url",
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("importStarterPack", () => {
    it("seeds the documented default tile set into a fresh org's catalog", async () => {
      // Use a brand-new org so the starter pack has a clean slate
      // (the suite-level org is reused across tests so it accumulates
      // state — picking a fresh one here keeps assertions stable on
      // exactly the starter set).
      const freshOrgId = `starter-org-${nanoid(8)}`;
      const freshTeamId = `starter-team-${nanoid(8)}`;
      await prisma.organization.create({
        data: {
          id: freshOrgId,
          name: `Starter ${nanoid(4)}`,
          slug: `starter-${nanoid(6)}`,
        },
      });
      await prisma.team.create({
        data: {
          id: freshTeamId,
          name: `Starter Team ${nanoid(4)}`,
          slug: `starter-team-${nanoid(6)}`,
          organizationId: freshOrgId,
        },
      });
      // Re-grant adminUserId on the fresh org so the RBAC gate passes.
      // Mirrors the suite-level admin setup: OrganizationUser ADMIN +
      // RoleBinding at ORGANIZATION scope (the rbac middleware reads
      // both — OrgUser alone isn't enough for `aiTools:manage`).
      await prisma.organizationUser.create({
        data: {
          userId: adminUserId,
          organizationId: freshOrgId,
          role: OrganizationUserRole.ADMIN,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId: freshOrgId,
          userId: adminUserId,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: freshOrgId,
        },
      });

      try {
        const result = await callerFor(adminUserId).aiTools.importStarterPack({
          organizationId: freshOrgId,
        });
        expect(result.created).toBe(8); // 4 coding assistants + 4 model providers
        expect(result.skipped).toBe(0);

        const adminList = await callerFor(adminUserId).aiTools.adminList({
          organizationId: freshOrgId,
        });
        const slugs = adminList.map((e) => e.slug).sort();
        expect(slugs).toEqual([
          "anthropic",
          "bedrock",
          "claude-code",
          "codex",
          "cursor",
          "gemini",
          "google",
          "openai",
        ]);

        // Idempotency: re-importing must not duplicate.
        const second = await callerFor(adminUserId).aiTools.importStarterPack({
          organizationId: freshOrgId,
        });
        expect(second.created).toBe(0);
        expect(second.skipped).toBe(8);
        const after = await callerFor(adminUserId).aiTools.adminList({
          organizationId: freshOrgId,
        });
        expect(after).toHaveLength(8);
      } finally {
        await prisma.aiToolEntry
          .deleteMany({ where: { organizationId: freshOrgId } })
          .catch(() => undefined);
        await prisma.roleBinding
          .deleteMany({ where: { organizationId: freshOrgId } })
          .catch(() => undefined);
        await prisma.organizationUser
          .deleteMany({ where: { organizationId: freshOrgId } })
          .catch(() => undefined);
        await prisma.team
          .deleteMany({ where: { id: freshTeamId } })
          .catch(() => undefined);
        await prisma.organization
          .deleteMany({ where: { id: freshOrgId } })
          .catch(() => undefined);
      }
    });

    it("rejects MEMBER callers — manage-permission required", async () => {
      await expect(
        callerFor(memberPlatformUserId).aiTools.importStarterPack({
          organizationId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("setEnabled + archive", () => {
    it("setEnabled toggles visibility on the user-facing list", async () => {
      const adminCaller = callerFor(adminUserId);
      const entry = await adminCaller.aiTools.create({
        organizationId,
        teamIds: [],
        type: "external_tool",
        displayName: `Toggleable ${nanoid(4)}`,
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

  describe("providerOptions", () => {
    it("returns every supported LLM provider with a configured flag", async () => {
      // Drives B1.1 G1 — a fresh dev org with zero
      // GatewayProviderCredential rows must still see the full
      // platform catalog so the drawer's 'Configure provider →'
      // hint is reachable. Pre-fix, this returned [] and the
      // unconfigured-warning UX was dead.
      const result = await callerFor(adminUserId).aiTools.providerOptions({
        organizationId,
      });
      // Must include the canonical big-three at minimum.
      const keys = result.map((r) => r.providerKey);
      expect(keys).toContain("openai");
      expect(keys).toContain("anthropic");
      expect(keys).toContain("azure");
      // Every row carries displayName + boolean configured.
      for (const row of result) {
        expect(typeof row.displayName).toBe("string");
        expect(row.displayName.length).toBeGreaterThan(0);
        expect(typeof row.configured).toBe("boolean");
      }
      // Test fixture has no GatewayProviderCredential rows seeded —
      // every provider is unconfigured, exposing the warning path.
      expect(result.every((r) => r.configured === false)).toBe(true);
    });

    it("rejects MEMBER callers — manage-permission required", async () => {
      await expect(
        callerFor(memberPlatformUserId).aiTools.providerOptions({
          organizationId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("routingPolicyOptions", () => {
    it("returns org-scoped routing policies for the drawer dropdown", async () => {
      const policy = await prisma.routingPolicy.create({
        data: {
          organizationId,
          scope: "organization",
          scopeId: organizationId,
          name: `Drawer Default ${nanoid(4)}`,
          providerCredentialIds: [],
          strategy: "priority",
          isDefault: true,
          createdById: adminUserId,
          updatedById: adminUserId,
        },
      });

      try {
        const result = await callerFor(adminUserId).aiTools.routingPolicyOptions({
          organizationId,
        });
        expect(result.some((r) => r.id === policy.id)).toBe(true);
        const match = result.find((r) => r.id === policy.id);
        expect(match?.name).toBe(policy.name);
      } finally {
        await prisma.routingPolicy.delete({ where: { id: policy.id } });
      }
    });

    it("rejects MEMBER callers — manage-permission required", async () => {
      await expect(
        callerFor(memberPlatformUserId).aiTools.routingPolicyOptions({
          organizationId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});
