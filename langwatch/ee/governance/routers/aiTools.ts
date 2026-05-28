// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

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
  SUPPORTED_TILE_TYPES,
} from "@ee/governance/services/aiToolEntry.service";

import { checkOrganizationPermission } from "~/server/api/rbac";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const typeSchema = z.enum(
  SUPPORTED_TILE_TYPES as readonly [string, ...string[]],
);

/// Tightened from a free-string to a base64 data URL for uploaded
/// icons or "preset:<kind>" / "preset:<namespace>:<kind>" for
/// built-ins. The nested-namespace shape lets each tile type carve
/// out its own preset registry without colliding (assistants ship
/// brand SVGs at `preset:claude_code`; internal tools ship lucide
/// icons at `preset:tool:globe`). Caught in B1.1 G2: the original
/// single-colon regex rejected `preset:tool:globe` from the
/// internal-tool drawer's preset picker.
///
/// Cap at ~256KB encoded (≈ 192KB binary) — large enough for an SVG
/// / 256×256 PNG, small enough to keep the Postgres row footprint
/// reasonable.
const iconAssetSchema = z
  .string()
  .max(262_144)
  .regex(
    /^(preset:[a-z0-9_]+(?::[a-z0-9_]+)?|data:image\/(svg\+xml|png|jpeg|webp);base64,[A-Za-z0-9+/=]+)$/,
    {
      message:
        "iconAsset must be 'preset:<kind>', 'preset:<namespace>:<kind>', or a base64 data URL (svg, png, jpeg, webp)",
    },
  )
  .nullable()
  .optional();

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
   * Per-org provider availability — drives the model_provider tile
   * preflight on /me. Returns the distinct set of `provider` strings
   * the calling user has access to via the scope ladder; the tile
   * compares its `config.providerKey` against this and renders an
   * actionable "Provider not configured" hint when missing, instead
   * of silently minting a VK that 502s on first curl.
   */
  providerAvailability: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:view"))
    .query(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      const configuredProviders = await service.listConfiguredProvidersForUser({
        organizationId: input.organizationId,
        userId: ctx.session.user.id,
      });
      return { configuredProviders };
    }),

  /**
   * Auto-fill helper for the Claude Code coding-assistant tile. Returns
   * the OTLP endpoint URL of an active claude_code IngestionSource in
   * the org so end users don't need a round-trip with admin to learn
   * the URL — only the bearer token stays in the admin-handoff path
   * (ingestSecret is hash-only on the server, members can't retrieve
   * it). Returns `null` when the org hasn't published a claude_code
   * source yet; tile then renders the all-placeholder template.
   *
   * Discloses ONLY the URL. No source name, no scope, no secret —
   * the URL is publicly resolvable per source-id anyway (the bearer
   * token gates the actual write). RBAC at `aiTools:view` (every org
   * member has it) is the right grant for the discoverability surface.
   */
  claudeCodeOtlpEndpoint: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:view"))
    .query(async ({ ctx, input }) => {
      const source = await ctx.prisma.ingestionSource.findFirst({
        where: {
          organizationId: input.organizationId,
          sourceType: "claude_code",
          archivedAt: null,
          status: { not: "disabled" },
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (!source) return { endpoint: null };
      return { endpoint: `/api/ingest/otel/${source.id}` };
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
        /// Empty array = org-wide (visible to every member).
        /// Non-empty = entry visible only to members of those teams.
        teamIds: z.array(z.string()).default([]),
        type: typeSchema,
        displayName: z.string().min(1).max(128),
        iconAsset: iconAssetSchema,
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
          teamIds: input.teamIds,
          type: input.type as (typeof SUPPORTED_TILE_TYPES)[number],
          displayName: input.displayName,
          iconAsset: input.iconAsset,
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
        iconAsset: iconAssetSchema,
        /// Pass to overwrite the team binding set. Empty = org-wide.
        /// Omit to leave the existing binding untouched.
        teamIds: z.array(z.string()).optional(),
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
          iconAsset: input.iconAsset,
          teamIds: input.teamIds,
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

  /**
   * One-click "import starter pack" — publishes the documented default
   * tile set (4 coding assistants + 4 model providers, all org-scoped)
   * onto a fresh org's catalog. Idempotent: re-imports skip slugs the
   * admin already has, so re-clicking after partial setup just fills
   * gaps without duplicating or re-skinning hand-curated entries.
   *
   * Closes the docs/code mismatch surfaced in the proper-governance
   * dogfood (admin-catalog.mdx promised the CTA, code didn't ship the
   * handler).
   */
  importStarterPack: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        // The admin's checkbox selection. Omitted = the full pack.
        slugs: z.array(z.string()).min(1).optional(),
      }),
    )
    .use(checkOrganizationPermission("aiTools:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      return await service.seedStarterPack({
        organizationId: input.organizationId,
        actorUserId: ctx.session.user.id,
        slugs: input.slugs,
      });
    }),

  /**
   * The starter-pack catalog the admin editor renders as a checklist.
   * Static org-agnostic projection — gated on aiTools:manage to match the
   * editor's own access (only catalog admins ever see it).
   */
  starterPackCatalog: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .query(() => {
      return AiToolEntryService.listStarterPackTiles();
    }),

  /**
   * Admin drawer dropdown source for the model_provider tile's
   * `providerKey`. Returns every provider the org has any
   * `ModelProvider` row for, with a `configured: boolean` flag the
   * drawer surfaces as a "Configure provider →" hint when false.
   * Wider than `providerAvailability`: an admin needs to see every
   * option they *could* expose, not only the live ones.
   */
  providerOptions: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .query(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      return await service.listProviderOptionsForAdmin({
        organizationId: input.organizationId,
      });
    }),

  /**
   * Admin drawer dropdown source for the model_provider tile's
   * `suggestedRoutingPolicyId`. Returns the org-scoped routing
   * policies (only — team-scoped policies are bound to a team's
   * personal-VK flow and not surfaceable through a tile config).
   */
  routingPolicyOptions: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("aiTools:manage"))
    .query(async ({ ctx, input }) => {
      const service = AiToolEntryService.create(ctx.prisma);
      return await service.listRoutingPolicyOptionsForAdmin({
        organizationId: input.organizationId,
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
