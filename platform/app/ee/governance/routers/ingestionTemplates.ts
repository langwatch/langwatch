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

import {
  IngestionTemplateService,
  InvalidSourceTypeError,
  PlatformTemplateImmutableError,
  TemplateNotFoundError,
} from "@ee/governance/services/ingestionTemplate.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

function mapServiceError(err: unknown): never {
  if (err instanceof TemplateNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof PlatformTemplateImmutableError) {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message });
  }
  if (err instanceof InvalidSourceTypeError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

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

  /**
   * Admin authoring: create an org-authored template. Slug is server-
   * generated. Platform rows live with `organizationId IS NULL` and are
   * never created via this endpoint.
   */
  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sourceType: z.string(),
        displayName: z.string().min(1).max(80),
        description: z.string().max(2000).optional(),
        iconAsset: z.string().max(20_000).optional(),
        credentialSchema: z
          .enum(["otlp_token", "static_api_key", "agent_id"])
          .nullable()
          .optional(),
        ottlRules: z.string().max(50_000).optional(),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionTemplateService.create(ctx.prisma);
      try {
        return await service.createOrgTemplate({
          organizationId: input.organizationId,
          callerUserId: ctx.session.user.id,
          sourceType: input.sourceType,
          displayName: input.displayName,
          description: input.description ?? null,
          iconAsset: input.iconAsset ?? null,
          credentialSchema:
            input.credentialSchema === "otlp_token" ? null : input.credentialSchema ?? null,
          ottlRules: input.ottlRules,
          surface: "trpc",
        });
      } catch (err) {
        mapServiceError(err);
      }
    }),

  /**
   * Replace `ottlRules` on an org-authored template. Platform rows
   * reject (FORBIDDEN). Audit-logged with line counts pre/post for the
   * forensic trail.
   */
  updateOttlRules: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        ottlRules: z.string().max(50_000),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionTemplateService.create(ctx.prisma);
      try {
        return await service.updateOttlRules({
          organizationId: input.organizationId,
          callerUserId: ctx.session.user.id,
          id: input.id,
          ottlRules: input.ottlRules,
          surface: "trpc",
        });
      } catch (err) {
        mapServiceError(err);
      }
    }),

  /**
   * Soft-archive an org-authored template. Platform rows reject.
   */
  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionTemplateService.create(ctx.prisma);
      try {
        await service.archiveOrgTemplate({
          organizationId: input.organizationId,
          callerUserId: ctx.session.user.id,
          id: input.id,
          surface: "trpc",
        });
        return { ok: true as const };
      } catch (err) {
        mapServiceError(err);
      }
    }),

  /**
   * Clone a platform-published template into the caller's org. Allows
   * admins to customize the OTTL of a platform default without touching
   * the canonical row. The clone starts as an exact copy; admin edits
   * via `updateOttlRules` from there.
   */
  cloneFromPlatform: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sourceTemplateId: z.string(),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = IngestionTemplateService.create(ctx.prisma);
      try {
        return await service.cloneFromPlatform({
          organizationId: input.organizationId,
          callerUserId: ctx.session.user.id,
          sourceTemplateId: input.sourceTemplateId,
          surface: "trpc",
        });
      } catch (err) {
        mapServiceError(err);
      }
    }),
});
