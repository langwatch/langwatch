// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * tRPC router for IngestionTemplate (admin/platform-curated catalog).
 *
 * RBAC: gates on `aiTools:*` because the admin surface for v1 lives as
 * a second tab on the existing `/settings/governance/tool-catalog`
 * page (per the Andre PM call at 73a3bccdb — folding Ingestion
 * Templates into the AiToolEntry catalog editor instead of carving
 * out a new route). User-facing read uses `aiTools:view` (every org
 * role); admin readonly uses `aiTools:manage` (org ADMIN).
 *
 * Spec: specs/ai-gateway/governance/ingestion-templates-catalog.feature
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { IngestionTemplateService } from "@ee/governance/services/ingestionTemplate.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

export const ingestionTemplatesRouter = createTRPCRouter({
  /**
   * User-facing catalog for `/me Trace Ingest`. Returns platform-published
   * defaults + any org-authored templates visible to the caller's org.
   * Disabled / archived rows are filtered out at the service layer.
   *
   * `ottlRules` is omitted from the user-facing shape — it's an internal
   * implementation detail, the user only needs the install copy + snippet.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:view"))
    .query(async ({ ctx, input }) => {
      const service = IngestionTemplateService.create(ctx.prisma);
      return await service.listForUser({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Admin readonly catalog — same union as `list` but INCLUDES `ottlRules`
   * so the admin transparency block can render the canonical OTTL.
   * v1 surface = read-only; admin OTTL authoring is deferred to v2.
   */
  adminList: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .query(async ({ ctx, input }) => {
      const service = IngestionTemplateService.create(ctx.prisma);
      return await service.listForOrgAdmin({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Single-template lookup by id, scoped to the caller's org. Cross-org
   * probes collapse to NOT_FOUND (no enumeration vector). Powers the
   * install drawer's metadata fetch when the user clicks a tile.
   */
  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("aiTools:view"))
    .query(async ({ ctx, input }) => {
      const service = IngestionTemplateService.create(ctx.prisma);
      const row = await service.findByIdForOrg({
        id: input.id,
        organizationId: input.organizationId,
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),
});
