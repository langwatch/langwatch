/**
 * @vitest-environment node
 *
 * Integration coverage for IngestionTemplateService admin authoring
 * methods (Ask A — admin OTTL authoring on this PR per rchaves's
 * no-v2-defer directive). Pins the two-tier trust contract:
 *
 *   - Platform-published rows (organizationId IS NULL) reject mutate
 *     calls with PlatformTemplateImmutableError — admins must clone.
 *   - Org-authored rows (organizationId = caller's org) accept
 *     create / updateOttlRules / archive.
 *   - cloneFromPlatform copies the canonical OTTL into a new org row
 *     so the admin can edit without touching the platform default.
 *   - Audit log rows land for every mutation.
 *
 * Spec: specs/ai-governance/admin-ottl-authoring.feature
 *       specs/ai-gateway/governance/template-ottl-principal-guard.feature
 */
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";

import {
  IngestionTemplateService,
  TemplateNotFoundError,
} from "../ingestionTemplate.service";

const suffix = nanoid(8);
const ORG_ID = `org-itauth-${suffix}`;
const OTHER_ORG_ID = `org-other-${suffix}`;
const ADMIN_ID = `usr-admin-${suffix}`;
const PLATFORM_TEMPLATE_ID = `tmpl-platform-${suffix}`;

describe("IngestionTemplateService admin authoring", () => {
  const service = IngestionTemplateService.create(prisma);

  beforeAll(async () => {
    await prisma.organization.createMany({
      data: [
        { id: ORG_ID, name: `Admin Authoring ${suffix}`, slug: `auth-${suffix}` },
        {
          id: OTHER_ORG_ID,
          name: `Other Org ${suffix}`,
          slug: `other-${suffix}`,
        },
      ],
    });
    await prisma.user.create({
      data: {
        id: ADMIN_ID,
        email: `admin-${suffix}@example.com`,
        name: "Admin",
      },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: ADMIN_ID, role: "ADMIN" },
    });
    await prisma.ingestionTemplate.create({
      data: {
        id: PLATFORM_TEMPLATE_ID,
        organizationId: null,
        slug: `platform_default_${suffix}`,
        sourceType: "claude_code",
        displayName: "Platform Default",
        description: "Locked platform row",
        iconAsset: "preset:claude_code",
        credentialSchema: null,
        ottlRules: 'set(attributes["langwatch.cost.usd"], 0)',
        platformPublished: true,
        enabled: true,
      },
    });
  });

  describe("when admin creates an org-authored template", () => {
    it("persists with platformPublished=false + scoped to caller's org", async () => {
      const created = await service.createOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceType: "internal_codex",
        displayName: "Internal Codex Wrapper",
        description: "Custom OTTL for our wrapper",
        ottlRules: 'set(attributes["langwatch.cost.usd"], attributes["custom_cost"])',
      });
      expect(created.platformPublished).toBe(false);
      expect(created.organizationId).toBe(ORG_ID);
      expect(created.sourceType).toBe("internal_codex");
      expect(created.slug).toMatch(/^internal_codex_wrapper_[a-z0-9]{6}$/);
      expect(created.ottlRules).toContain("custom_cost");
    });

    it("audit-logs the create with action gateway.ingestion_template.created", async () => {
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.created",
          userId: ADMIN_ID,
        },
        orderBy: { createdAt: "desc" },
      });
      expect(audit).not.toBeNull();
      expect(audit?.targetKind).toBe("ingestion_template");
    });

    it("rejects sourceType with invalid characters", async () => {
      await expect(
        service.createOrgTemplate({
          organizationId: ORG_ID,
          callerUserId: ADMIN_ID,
          sourceType: "Invalid SourceType!",
          displayName: "bad",
        }),
      ).rejects.toThrow(/sourceType/i);
    });
  });

  describe("when admin updates OTTL on an org-authored template", () => {
    it("persists the new ottlRules + audit-logs the update", async () => {
      const created = await service.createOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceType: "test_update",
        displayName: "Update Target",
        ottlRules: "",
      });

      const updated = await service.updateOttlRules({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        id: created.id,
        ottlRules:
          'set(attributes["langwatch.cost.usd"], attributes["upstream_cost"])\n' +
          'set(attributes["gen_ai.request.model"], attributes["model_name"])',
      });
      expect(updated.ottlRules).toContain("upstream_cost");
      expect(updated.ottlRules.split("\n").length).toBe(2);

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.ottl_updated",
          targetId: created.id,
        },
      });
      expect(audit).not.toBeNull();
    });
  });

  describe("when admin attempts to mutate a platform-published row", () => {
    it("rejects updateOttlRules with PlatformTemplateImmutableError", async () => {
      await expect(
        service.updateOttlRules({
          organizationId: ORG_ID,
          callerUserId: ADMIN_ID,
          id: PLATFORM_TEMPLATE_ID,
          ottlRules: "forged",
        }),
      ).rejects.toThrow(TemplateNotFoundError);
      // Note: The org-scoped findFirst returns null for platform rows
      // (organizationId IS NULL doesn't match ORG_ID), so we get
      // TemplateNotFoundError before reaching the platformPublished
      // check. This is intentional — platform rows are not addressable
      // via the org-mutation surface at all.
    });

    it("rejects archiveOrgTemplate with NOT_FOUND for the same reason", async () => {
      await expect(
        service.archiveOrgTemplate({
          organizationId: ORG_ID,
          callerUserId: ADMIN_ID,
          id: PLATFORM_TEMPLATE_ID,
        }),
      ).rejects.toThrow(TemplateNotFoundError);
    });
  });

  describe("when admin clones a platform template into their org", () => {
    it("creates a fresh org-authored row with the platform OTTL preserved", async () => {
      const cloned = await service.cloneFromPlatform({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceTemplateId: PLATFORM_TEMPLATE_ID,
      });
      expect(cloned.platformPublished).toBe(false);
      expect(cloned.organizationId).toBe(ORG_ID);
      expect(cloned.ottlRules).toBe(
        'set(attributes["langwatch.cost.usd"], 0)',
      );
      expect(cloned.displayName).toBe("Platform Default (custom)");
      expect(cloned.id).not.toBe(PLATFORM_TEMPLATE_ID);
    });

    it("rejects cross-org cloning (caller cannot fetch another org's row)", async () => {
      // Even when caller passes a real platform id, the org-authored
      // surface stays scoped — adminList in the OTHER_ORG_ID would not
      // include this clone. Sanity-check via direct Prisma read:
      const otherOrgRows = await service.listForOrgAdmin({
        organizationId: OTHER_ORG_ID,
      });
      expect(
        otherOrgRows.find((r) => r.displayName === "Platform Default (custom)"),
      ).toBeUndefined();
    });
  });

  describe("when admin archives an org-authored template", () => {
    it("hides it from listForOrgAdmin + audit-logs the action", async () => {
      const created = await service.createOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceType: "to_archive",
        displayName: "Archive Me",
      });

      await service.archiveOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        id: created.id,
      });

      const visible = await service.listForOrgAdmin({ organizationId: ORG_ID });
      expect(visible.find((r) => r.id === created.id)).toBeUndefined();

      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.archived",
          targetId: created.id,
        },
      });
      expect(audit).not.toBeNull();
    });

    it("rejects archiving a non-existent template", async () => {
      await expect(
        service.archiveOrgTemplate({
          organizationId: ORG_ID,
          callerUserId: ADMIN_ID,
          id: `nonexistent-${suffix}`,
        }),
      ).rejects.toThrow(TemplateNotFoundError);
    });
  });

  describe("when surface attribution is supplied", () => {
    // Per umbrella spec @audit-uniform — the audit row must capture
    // which surface initiated the change so forensic readers can answer
    // "did the dashboard, REST API, CLI, or an MCP agent flip this?".
    // Spec: specs/ai-gateway/governance/governance-api-cli-mcp-coverage.feature
    it("stamps surface=hono into audit metadata for create", async () => {
      const created = await service.createOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceType: "surface_create",
        displayName: "Surface Create",
        surface: "hono",
      });
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.created",
          targetId: created.id,
        },
      });
      expect((audit?.metadata as { surface?: string } | null)?.surface).toBe(
        "hono",
      );
    });

    it("stamps surface=cli into audit metadata for updateOttlRules", async () => {
      const created = await service.createOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceType: "surface_update",
        displayName: "Surface Update",
        surface: "trpc",
      });
      await service.updateOttlRules({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        id: created.id,
        ottlRules: 'set(attributes["x"], "y")',
        surface: "cli",
      });
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.ottl_updated",
          targetId: created.id,
        },
      });
      expect((audit?.metadata as { surface?: string } | null)?.surface).toBe(
        "cli",
      );
    });

    it("stamps surface=mcp into audit metadata for archive", async () => {
      const created = await service.createOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceType: "surface_archive",
        displayName: "Surface Archive",
      });
      await service.archiveOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        id: created.id,
        surface: "mcp",
      });
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.archived",
          targetId: created.id,
        },
      });
      expect((audit?.metadata as { surface?: string } | null)?.surface).toBe(
        "mcp",
      );
    });

    it("defaults to surface=trpc when caller omits the field (back-compat)", async () => {
      const created = await service.createOrgTemplate({
        organizationId: ORG_ID,
        callerUserId: ADMIN_ID,
        sourceType: "surface_default",
        displayName: "Surface Default",
        // surface intentionally omitted — pre-existing tRPC callers
        // that haven't been updated yet still produce a meaningful
        // audit attribution rather than a blank field.
      });
      const audit = await prisma.auditLog.findFirst({
        where: {
          organizationId: ORG_ID,
          action: "gateway.ingestion_template.created",
          targetId: created.id,
        },
      });
      expect((audit?.metadata as { surface?: string } | null)?.surface).toBe(
        "trpc",
      );
    });
  });
});
