/**
 * tRPC router for the AI Tools Portal catalog (Phase 7).
 *
 * RBAC: gates on the resource-specific catalog
 *   - `aiTools:view` for reads (list-for-user) — every org member
 *   - `aiTools:manage` for writes + admin reads — org ADMIN by default
 *
 * Spec: specs/ai-governance/personal-portal/tool-catalog-*.feature
 *
 * Reuse map (per Phase 7 surface contract):
 *   - coding-assistant tile click → existing `langwatch login` flow,
 *     no backend involvement.
 *   - model-provider tile click → REUSES `personalVirtualKeys.issuePersonal`
 *     with `routingPolicyId` resolved from the catalog entry's
 *     `config.suggestedRoutingPolicyId`.
 *   - external-tool tile click → markdown render + linkUrl, no backend.
 *
 * So this router OWNS the catalog entity only — the per-tile behaviors
 * are wired client-side against existing endpoints.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  AiToolEntryService,
  SUPPORTED_SCOPES,
  SUPPORTED_TILE_TYPES,
} from "@ee/governance/services/aiToolEntry.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const scopeSchema = z.enum(SUPPORTED_SCOPES as readonly [string, ...string[]]);
const typeSchema = z.enum(
  SUPPORTED_TILE_TYPES as readonly [string, ...string[]],
);

export const aiToolsRouter = createTRPCRouter({
  /**
   * User-facing list — returns enabled, non-archived entries the
   * caller can see (org-scoped + their team-scoped, with team
   * overriding org by slug). Powers the /me portal grid.
   */
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:view"))
    .query(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      return await service.listForUser({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
      });
    }),

  /**
   * Admin list — includes disabled + archived. Powers the catalog
   * editor at /settings/governance/tool-catalog.
   */
  adminList: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .query(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      return await service.listForAdmin({
        organizationId: input.organizationId,
      });
    }),

  get: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .query(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      const row = await service.findById({
        id: input.id,
        organizationId: input.organizationId,
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  create: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        scope: scopeSchema,
        scopeId: z.string().min(1),
        type: typeSchema,
        displayName: z.string().min(1).max(128),
        slug: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9][a-z0-9_\-]*$/, {
            message:
              "Slug must be lowercase alphanumeric, dash, or underscore (no spaces)",
          }),
        iconKey: z.string().max(64).nullable().optional(),
        order: z.number().int().min(0).optional(),
        config: z.record(z.string(), z.unknown()),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      try {
        return await service.create({
          organizationId: input.organizationId,
          scope: input.scope as (typeof SUPPORTED_SCOPES)[number],
          scopeId: input.scopeId,
          type: input.type as (typeof SUPPORTED_TILE_TYPES)[number],
          displayName: input.displayName,
          slug: input.slug,
          iconKey: input.iconKey,
          order: input.order,
          config: input.config,
          actorUserId: ctx.session.user.id,
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid config for ${input.type}: ${err.issues.map((i) => i.message).join("; ")}`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  update: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        displayName: z.string().min(1).max(128).optional(),
        iconKey: z.string().max(64).nullable().optional(),
        order: z.number().int().min(0).optional(),
        enabled: z.boolean().optional(),
        type: typeSchema.optional(),
        config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      try {
        return await service.update({
          id: input.id,
          organizationId: input.organizationId,
          displayName: input.displayName,
          iconKey: input.iconKey,
          order: input.order,
          enabled: input.enabled,
          type: input.type as
            | (typeof SUPPORTED_TILE_TYPES)[number]
            | undefined,
          config: input.config,
          actorUserId: ctx.session.user.id,
        });
      } catch (err) {
        if (err instanceof z.ZodError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid config: ${err.issues.map((i) => i.message).join("; ")}`,
            cause: err,
          });
        }
        throw err;
      }
    }),

  archive: protectedProcedure
    .input(z.object({ organizationId: z.string(), id: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      return await service.archive({
        id: input.id,
        organizationId: input.organizationId,
      });
    }),

  /**
   * Single-purpose enable/disable shorthand. Equivalent to calling
   * `update({ id, enabled })` but exists as its own procedure so the
   * admin catalog editor's per-row toggle has a clean intent-named
   * mutation (matches the BDD spec contract — see
   * specs/ai-governance/personal-portal/admin-catalog-editor.feature).
   */
  setEnabled: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        id: z.string(),
        enabled: z.boolean(),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      return await service.update({
        id: input.id,
        organizationId: input.organizationId,
        enabled: input.enabled,
        actorUserId: ctx.session.user.id,
      });
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        updates: z
          .array(z.object({ id: z.string(), order: z.number().int().min(0) }))
          .min(1),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      await service.reorder({
        organizationId: input.organizationId,
        updates: input.updates,
      });
      return { ok: true };
    }),
});
