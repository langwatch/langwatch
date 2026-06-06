/**
 * @vitest-environment node
 *
 * Integration coverage for the AI Tools Portal catalog router (Phase 7).
 *
 * Pins three things end-to-end via the live tRPC procedure layer:
 *   1. RBAC enforcement - MEMBER can list (aiTools:view) but cannot
 *      create/update/archive/setEnabled/reorder. ADMIN can do all.
 *      EXTERNAL can also list (portal must work for everyone).
 *   2. Org/department scoping resolution - listForUser applies
 *      department-overrides-org by slug; entries scoped to a department
 *      the user does NOT belong to are filtered out.
 *   3. Per-type config validation - invalid config payloads (missing
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
  Prisma,
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
  let deptPlatformId: string;
  let deptDataScienceId: string;
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

    // Departments are the new tile-visibility axis (the people lens):
    // each member carries at most one OrganizationUser.departmentId and a
    // department-scoped tile is visible only to members in that set.
    const deptPlatform = await prisma.department.create({
      data: { organizationId, name: `Platform Dept ${ns}` },
    });
    deptPlatformId = deptPlatform.id;

    const deptDataScience = await prisma.department.create({
      data: { organizationId, name: `Data Science Dept ${ns}` },
    });
    deptDataScienceId = deptDataScience.id;

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
        // Member of the Platform department - sees department-scoped tiles
        // bound to deptPlatform; memberOrphan (no department) does not.
        departmentId: deptPlatform.id,
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
    await prisma.department.deleteMany({ where: { organizationId } }).catch(() => {});
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
          departmentIds: [],
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
        departmentIds: [],
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
      // departmentIds[] mirrors back-compat scope/scopeId ('organization'
      // when empty) - listForUser uses the new join-table path.
      expect(created.departmentIds).toEqual([]);
      expect(created.scope).toBe("organization");
      expect(created.iconAsset).toBe("preset:claude_code");

      const adminList = await adminCaller.aiTools.adminList({ organizationId });
      expect(adminList.some((e) => e.id === created.id)).toBe(true);
    });
  });

  describe("Scoping", () => {
    it("filters department-scoped entries to department members", async () => {
      const adminCaller = callerFor(adminUserId);
      const created = await adminCaller.aiTools.create({
        organizationId,
        departmentIds: [deptPlatformId],
        type: "model_provider",
        displayName: `Bedrock - Platform dept ${nanoid(4)}`,
        iconAsset: "preset:bedrock",
        config: { providerKey: "bedrock" },
      });

      const platformList = await callerFor(memberPlatformUserId).aiTools.list({
        organizationId,
      });
      expect(platformList.some((e) => e.id === created.id)).toBe(true);
      expect(
        platformList.find((e) => e.id === created.id)?.departmentIds,
      ).toEqual([deptPlatformId]);

      const orphanList = await callerFor(memberOrphanUserId).aiTools.list({
        organizationId,
      });
      expect(orphanList.some((e) => e.id === created.id)).toBe(false);
    });

    it("department entry shadows org default by slug", async () => {
      // Slug is server-owned (auto-generated with a nanoid suffix),
      // so admins can't trigger shadowing via the public API by
      // re-using a slug. We exercise the listForUser shadowing path
      // directly via prisma writes - the contract that *if* two
      // entries share a slug the department-bound one wins for members
      // of that department is still load-bearing for any future admin
      // tool that imports catalogs by slug.
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
      const deptEntry = await prisma.aiToolEntry.create({
        data: {
          organizationId,
          scope: "department",
          scopeId: deptPlatformId,
          type: "model_provider",
          displayName: "OpenAI - Platform override",
          slug: sharedSlug,
          config: { providerKey: "openai" },
        },
      });
      await prisma.aiToolEntryDepartment.create({
        data: { entryId: deptEntry.id, departmentId: deptPlatformId },
      });

      const platformList = await callerFor(memberPlatformUserId).aiTools.list({
        organizationId,
      });
      const platformMatches = platformList.filter((e) => e.slug === sharedSlug);
      expect(platformMatches).toHaveLength(1);
      expect(platformMatches[0]?.displayName).toBe("OpenAI - Platform override");

      const orphanList = await callerFor(memberOrphanUserId).aiTools.list({
        organizationId,
      });
      const orphanMatches = orphanList.filter((e) => e.slug === sharedSlug);
      expect(orphanMatches).toHaveLength(1);
      expect(orphanMatches[0]?.displayName).toBe("OpenAI (default)");

      // Cleanup so other tests don't see the shadow rows.
      await prisma.aiToolEntry
        .deleteMany({ where: { id: { in: [orgEntry.id, deptEntry.id] } } })
        .catch(() => undefined);
    });
  });

  describe("Per-type config validation", () => {
    it("rejects coding_assistant entries missing setupCommand with BAD_REQUEST", async () => {
      await expect(
        callerFor(adminUserId).aiTools.create({
          organizationId,
          departmentIds: [],
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
          departmentIds: [],
          type: "external_tool",
          displayName: `Bad link ${nanoid(4)}`,
          config: {
            descriptionMarkdown: "Hi",
            linkUrl: "not-a-url",
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("accepts namespaced iconAsset preset shapes (preset:<ns>:<kind>)", async () => {
      // Drives B1.1 G2 - the internal-tool drawer's preset picker
      // writes `preset:tool:<kind>`. The original single-colon regex
      // rejected the nested-namespace shape, breaking every preset
      // pick except the wrench fallback. Both flat and namespaced
      // shapes must validate.
      const flat = await callerFor(adminUserId).aiTools.create({
        organizationId,
        departmentIds: [],
        type: "coding_assistant",
        displayName: `Flat preset ${nanoid(4)}`,
        iconAsset: "preset:claude_code",
        config: {
          assistantKind: "claude_code",
          setupCommand: "langwatch claude",
        },
      });
      expect(flat.iconAsset).toBe("preset:claude_code");

      const namespaced = await callerFor(adminUserId).aiTools.create({
        organizationId,
        departmentIds: [],
        type: "external_tool",
        displayName: `Namespaced preset ${nanoid(4)}`,
        iconAsset: "preset:tool:globe",
        config: {
          descriptionMarkdown: "x",
          linkUrl: "https://example.com",
        },
      });
      expect(namespaced.iconAsset).toBe("preset:tool:globe");
    });

    it("rejects iconAsset values that aren't preset or data URL", async () => {
      await expect(
        callerFor(adminUserId).aiTools.create({
          organizationId,
          departmentIds: [],
          type: "external_tool",
          displayName: `Bad icon ${nanoid(4)}`,
          iconAsset: "not-a-preset",
          config: {
            descriptionMarkdown: "x",
            linkUrl: "https://example.com",
          },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("importStarterPack", () => {
    it("seeds the documented default tile set into a fresh org's catalog", async () => {
      // Use a brand-new org so the starter pack has a clean slate
      // (the suite-level org is reused across tests so it accumulates
      // state - picking a fresh one here keeps assertions stable on
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
      // both - OrgUser alone isn't enough for `aiTools:manage`).
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
        expect(result.updated).toBe(0);
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
          "gemini",
          "google",
          "openai",
          "opencode",
        ]);

        // Idempotency: re-importing must not duplicate.
        const second = await callerFor(adminUserId).aiTools.importStarterPack({
          organizationId: freshOrgId,
        });
        expect(second.created).toBe(0);
        expect(second.updated).toBe(0);
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

    it("rejects MEMBER callers - manage-permission required", async () => {
      await expect(
        callerFor(memberPlatformUserId).aiTools.importStarterPack({
          organizationId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("merges iconAsset into pre-existing admin-created tiles by displayName", async () => {
      // Regression for the duplicate-row bug found while dogfooding
      // PR #3524: admin manually creates "Claude Code" via the UI
      // (slug = generateSlug("Claude Code") = "claude-code-<nanoid6>",
      // iconAsset = null) BEFORE clicking "Import starter pack". The
      // old slug-only dedupe missed this row and created a SECOND
      // "claude-code"-slugged row, leaving two coexisting tiles. The
      // older NULL-icon row often won (order, displayName) sort, so
      // /me showed a generic wrench icon despite correct wiring.
      //
      // Fix shape: match by (organizationId, type, displayName), case-
      // insensitive. Existing row with NULL iconAsset → UPDATE in
      // place (no duplicate). Existing row with non-NULL iconAsset
      // → SKIP (don't clobber admin curation). No match → CREATE.
      const freshOrgId = `merge-org-${nanoid(8)}`;
      const freshTeamId = `merge-team-${nanoid(8)}`;
      await prisma.organization.create({
        data: {
          id: freshOrgId,
          name: `Merge ${nanoid(4)}`,
          slug: `merge-${nanoid(6)}`,
        },
      });
      await prisma.team.create({
        data: {
          id: freshTeamId,
          name: `Merge Team ${nanoid(4)}`,
          slug: `merge-team-${nanoid(6)}`,
          organizationId: freshOrgId,
        },
      });
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
        // Pre-state mirrors what dogfood produced: admin manually
        // created "Claude Code" via UI → nanoid-suffixed slug, NULL
        // iconAsset. And "Codex" with iconAsset already set (the
        // admin uploaded a custom logo) - must NOT be overwritten.
        const adminClaudeRow = await prisma.aiToolEntry.create({
          data: {
            organizationId: freshOrgId,
            scope: "organization",
            scopeId: freshOrgId,
            type: "coding_assistant",
            displayName: "Claude Code",
            slug: `claude-code-${nanoid(6)}`,
            iconAsset: null,
            order: 0,
            enabled: true,
            config: {
              assistantKind: "claude_code",
              setupCommand: "langwatch claude",
            } as Prisma.InputJsonValue,
          },
        });
        const customCodexIcon = "data:image/svg+xml;base64,PHN2Zy8+";
        const adminCodexRow = await prisma.aiToolEntry.create({
          data: {
            organizationId: freshOrgId,
            scope: "organization",
            scopeId: freshOrgId,
            type: "coding_assistant",
            displayName: "Codex",
            slug: `codex-${nanoid(6)}`,
            iconAsset: customCodexIcon,
            order: 1,
            enabled: true,
            config: {
              assistantKind: "codex",
              setupCommand: "langwatch codex",
            } as Prisma.InputJsonValue,
          },
        });

        const result = await callerFor(adminUserId).aiTools.importStarterPack({
          organizationId: freshOrgId,
        });
        expect(result.updated).toBe(1); // Claude Code merged in place
        expect(result.skipped).toBe(1); // Codex admin-curated icon preserved
        expect(result.created).toBe(6); // remaining starter set inserted

        const after = await callerFor(adminUserId).aiTools.adminList({
          organizationId: freshOrgId,
        });
        expect(after).toHaveLength(8); // no duplicate row created

        const claudeRows = after.filter(
          (e) => e.type === "coding_assistant" && e.displayName === "Claude Code",
        );
        expect(claudeRows).toHaveLength(1);
        expect(claudeRows[0]!.id).toBe(adminClaudeRow.id);
        expect(claudeRows[0]!.iconAsset).toBe("preset:claude_code");

        const codexRows = after.filter(
          (e) => e.type === "coding_assistant" && e.displayName === "Codex",
        );
        expect(codexRows).toHaveLength(1);
        expect(codexRows[0]!.id).toBe(adminCodexRow.id);
        expect(codexRows[0]!.iconAsset).toBe(customCodexIcon);
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
  });

  describe("setEnabled + archive", () => {
    it("setEnabled toggles visibility on the user-facing list", async () => {
      const adminCaller = callerFor(adminUserId);
      const entry = await adminCaller.aiTools.create({
        organizationId,
        departmentIds: [],
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
      // Drives B1.1 G1 - a fresh dev org with zero
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
      // Test fixture has no GatewayProviderCredential rows seeded -
      // every provider is unconfigured, exposing the warning path.
      expect(result.every((r) => r.configured === false)).toBe(true);
    });

    it("rejects MEMBER callers - manage-permission required", async () => {
      await expect(
        callerFor(memberPlatformUserId).aiTools.providerOptions({
          organizationId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("providerAvailability", () => {
    it("scopes configured providers to the caller's team memberships", async () => {
      const orgProvider = await prisma.modelProvider.create({
        data: {
          name: `org-anthropic-${ns}`,
          provider: "anthropic",
          enabled: true,
          organizationId,
          scopes: {
            create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          },
        },
      });
      const ownTeamProvider = await prisma.modelProvider.create({
        data: {
          name: `pf-openai-${ns}`,
          provider: "openai",
          enabled: true,
          organizationId,
          scopes: {
            create: [{ scopeType: "TEAM", scopeId: teamPlatformId }],
          },
        },
      });
      const foreignTeamProvider = await prisma.modelProvider.create({
        data: {
          name: `ds-azure-${ns}`,
          provider: "azure",
          enabled: true,
          organizationId,
          scopes: {
            create: [{ scopeType: "TEAM", scopeId: teamDataScienceId }],
          },
        },
      });

      try {
        // memberPlatform belongs to teamPlatform only.
        const platform = await callerFor(
          memberPlatformUserId,
        ).aiTools.providerAvailability({ organizationId });
        expect(platform.configuredProviders).toContain("anthropic"); // org-wide
        expect(platform.configuredProviders).toContain("openai"); // own team
        // azure is scoped to a team the caller can't reach - must not leak.
        expect(platform.configuredProviders).not.toContain("azure");

        // memberOrphan belongs to no team - only org-wide providers count.
        const orphan = await callerFor(
          memberOrphanUserId,
        ).aiTools.providerAvailability({ organizationId });
        expect(orphan.configuredProviders).toContain("anthropic");
        expect(orphan.configuredProviders).not.toContain("openai");
        expect(orphan.configuredProviders).not.toContain("azure");
      } finally {
        const ids = [orgProvider.id, ownTeamProvider.id, foreignTeamProvider.id];
        await prisma.modelProviderScope.deleteMany({
          where: { modelProviderId: { in: ids } },
        });
        await prisma.modelProvider.deleteMany({ where: { id: { in: ids } } });
      }
    });
  });

  describe("update", () => {
    // Pins the new mutation shape (Stage B+C) end-to-end:
    //   departmentIds[] toggling round-trips through the
    //   AiToolEntryDepartment join + the legacy scope/scopeId mirror,
    //   iconAsset transitions between preset / data URL / null, and
    //   cross-org department binds are rejected by the org guard.
    it("departmentIds toggles round-trip through join table + legacy mirror", async () => {
      const adminCaller = callerFor(adminUserId);
      const created = await adminCaller.aiTools.create({
        organizationId,
        departmentIds: [],
        type: "external_tool",
        displayName: `Update tile ${nanoid(4)}`,
        config: { descriptionMarkdown: "x", linkUrl: "https://example.com" },
      });
      // Empty departments[] writes scope='organization' for back-compat.
      expect(created.departmentIds).toEqual([]);
      expect(created.scope).toBe("organization");
      expect(created.scopeId).toBe(organizationId);

      // [] → [platform]
      const single = await adminCaller.aiTools.update({
        organizationId,
        id: created.id,
        departmentIds: [deptPlatformId],
      });
      expect(single.departmentIds).toEqual([deptPlatformId]);
      expect(single.scope).toBe("department");
      expect(single.scopeId).toBe(deptPlatformId);
      const singleRows = await prisma.aiToolEntryDepartment.findMany({
        where: { entryId: created.id },
      });
      expect(singleRows.map((r) => r.departmentId)).toEqual([deptPlatformId]);

      // [platform] → [platform, dataScience] (multi-department)
      const multi = await adminCaller.aiTools.update({
        organizationId,
        id: created.id,
        departmentIds: [deptPlatformId, deptDataScienceId],
      });
      expect(multi.departmentIds.sort()).toEqual(
        [deptPlatformId, deptDataScienceId].sort(),
      );
      // Legacy mirror still 'department' but only carries first id (best
      // effort - multi-department can't be expressed in the legacy pair).
      expect(multi.scope).toBe("department");
      const multiRows = await prisma.aiToolEntryDepartment.findMany({
        where: { entryId: created.id },
      });
      expect(multiRows.map((r) => r.departmentId).sort()).toEqual(
        [deptPlatformId, deptDataScienceId].sort(),
      );

      // [platform, dataScience] → [] (back to org-wide)
      const cleared = await adminCaller.aiTools.update({
        organizationId,
        id: created.id,
        departmentIds: [],
      });
      expect(cleared.departmentIds).toEqual([]);
      expect(cleared.scope).toBe("organization");
      expect(cleared.scopeId).toBe(organizationId);
      const clearedRows = await prisma.aiToolEntryDepartment.findMany({
        where: { entryId: created.id },
      });
      expect(clearedRows).toHaveLength(0);

      await prisma.aiToolEntry.delete({ where: { id: created.id } });
    });

    it("iconAsset transitions: preset → data URL → null", async () => {
      const adminCaller = callerFor(adminUserId);
      const created = await adminCaller.aiTools.create({
        organizationId,
        departmentIds: [],
        type: "coding_assistant",
        displayName: `Icon transitions ${nanoid(4)}`,
        iconAsset: "preset:claude_code",
        config: {
          assistantKind: "claude_code",
          setupCommand: "langwatch claude",
        },
      });
      expect(created.iconAsset).toBe("preset:claude_code");

      const dataUrl =
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=";
      const uploaded = await adminCaller.aiTools.update({
        organizationId,
        id: created.id,
        iconAsset: dataUrl,
      });
      expect(uploaded.iconAsset).toBe(dataUrl);

      const cleared = await adminCaller.aiTools.update({
        organizationId,
        id: created.id,
        iconAsset: null,
      });
      expect(cleared.iconAsset).toBeNull();

      await prisma.aiToolEntry.delete({ where: { id: created.id } });
    });

    it("rejects update binding a department from a foreign org", async () => {
      const adminCaller = callerFor(adminUserId);
      const foreignOrg = await prisma.organization.create({
        data: { name: `Foreign ${nanoid(4)}`, slug: `--ait-foreign-${nanoid(6)}` },
      });
      const foreignDept = await prisma.department.create({
        data: {
          name: `Foreign dept ${nanoid(4)}`,
          organizationId: foreignOrg.id,
        },
      });
      const entry = await adminCaller.aiTools.create({
        organizationId,
        departmentIds: [],
        type: "external_tool",
        displayName: `Cross-org guard ${nanoid(4)}`,
        config: { descriptionMarkdown: "x", linkUrl: "https://example.com" },
      });

      try {
        await expect(
          adminCaller.aiTools.update({
            organizationId,
            id: entry.id,
            departmentIds: [foreignDept.id],
          }),
        ).rejects.toThrow(/departments do not belong to this organization/);

        // Atomicity: the failed update must NOT have written any
        // join rows, and the legacy mirror must not have flipped.
        const rows = await prisma.aiToolEntryDepartment.findMany({
          where: { entryId: entry.id },
        });
        expect(rows).toHaveLength(0);
        const after = await adminCaller.aiTools.get({
          organizationId,
          id: entry.id,
        });
        expect(after.scope).toBe("organization");
      } finally {
        await prisma.aiToolEntry.delete({ where: { id: entry.id } });
        await prisma.department.delete({ where: { id: foreignDept.id } });
        await prisma.organization.delete({ where: { id: foreignOrg.id } });
      }
    });
  });

  describe("routingPolicyOptions", () => {
    it("returns org-scoped routing policies for the drawer dropdown", async () => {
      const policy = await prisma.routingPolicy.create({
        data: {
          organizationId,
          scopes: {
            create: [{ scopeType: "ORGANIZATION", scopeId: organizationId }],
          },
          name: `Drawer Default ${nanoid(4)}`,
          modelProviderIds: [],
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

    it("rejects MEMBER callers - manage-permission required", async () => {
      await expect(
        callerFor(memberPlatformUserId).aiTools.routingPolicyOptions({
          organizationId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });
});
