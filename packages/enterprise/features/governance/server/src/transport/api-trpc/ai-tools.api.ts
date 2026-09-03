/**
 * AI Tools Portal catalog tRPC surface.
 *
 * Reads on `aiTools:view` (user-facing catalog, every org member), writes and
 * admin reads on `aiTools:manage` (org ADMIN by default). The router OWNS the
 * catalog entity only; per-tile behaviour is wired client-side against
 * existing endpoints:
 *
 *   - coding-assistant tile click → existing `langwatch login` flow.
 *   - model-provider tile click → REUSES `personalVirtualKeys.issuePersonal`
 *     with `routingPolicyId` resolved from the catalog entry's
 *     `config.suggestedRoutingPolicyId`.
 *   - external-tool tile click → markdown render + linkUrl, no backend.
 *
 * `list` lazily provisions the standard default catalog so a fresh org
 * renders tiles instead of the empty state. The provisioning is fire-and-
 * forget: if it fails the list still serves whatever exists, and the
 * failure is logged rather than re-raised — this is the one non-obvious
 * concession here, and the try/catch is why.
 *
 * `create` and `update` translate a service-side `ZodError` (from schemas
 * that validate the per-type config on the way in) into a `ValidationError`
 * carrying the offending message in `meta.formErrors`, so the
 * `validation_error` copy renders it verbatim rather than the code slug —
 * same shape as `anomalyRules`.
 *
 * Spec: specs/ai-governance/personal-portal/tool-catalog-*.feature
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import {
  AI_TOOL_STARTER_TILES,
  AI_TOOL_TYPES,
  type GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";

const logger = createLogger("langwatch:governance:ai-tools");

export type AiToolsTrpcContext = Readonly<{
  app: Readonly<{ governance: GovernanceService }>;
  actor(): Readonly<{ id: string }>;
}>;

type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type AiToolsTrpcProcedures<
  TContext extends AiToolsTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  policy(permission: AuthzPermission): ProcedureDecorator;
}>;

const typeSchema = z.enum(AI_TOOL_TYPES as unknown as [string, ...string[]]);

/**
 * Tightened from a free string to a base64 data URL for uploaded icons, or
 * `preset:<kind>` / `preset:<namespace>:<kind>` for built-ins. The nested-
 * namespace shape lets each tile type carve out its own preset registry
 * without colliding (assistants ship brand SVGs at `preset:claude_code`;
 * internal tools ship lucide icons at `preset:tool:globe`).
 *
 * Capped at ~256KB encoded (~192KB binary) — large enough for an SVG or
 * 256x256 PNG, small enough to keep the Postgres row reasonable.
 */
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

const organizationScope = z.object({ organizationId: z.string() });
const idAndOrg = organizationScope.extend({ id: z.string() });

const createSchema = organizationScope.extend({
  /** Empty = org-wide (every member). Non-empty = only members of the named departments. */
  departmentIds: z.array(z.string()).default([]),
  type: typeSchema,
  displayName: z.string().min(1).max(128),
  iconAsset: iconAssetSchema,
  order: z.number().int().min(0).optional(),
  config: z.record(z.string(), z.unknown()),
});

const updateSchema = idAndOrg.extend({
  displayName: z.string().min(1).max(128).optional(),
  iconAsset: iconAssetSchema,
  /** Pass to overwrite the department binding set. Empty = org-wide. Omit to leave it. */
  departmentIds: z.array(z.string()).optional(),
  order: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  type: typeSchema.optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const setEnabledSchema = idAndOrg.extend({ enabled: z.boolean() });

const importStarterPackSchema = organizationScope.extend({
  /** Admin's checkbox selection. Omitted = the full pack. */
  slugs: z.array(z.string()).min(1).optional(),
});

const reorderSchema = organizationScope.extend({
  updates: z.array(z.object({ id: z.string(), order: z.number().int().min(0) })).min(1),
});

function translateConfigValidationError(err: unknown, type?: string): never {
  if (isZodLikeError(err)) {
    const complaint = `Invalid config${type ? ` for ${type}` : ""}: ${err.issues
      .map((issue) => issue.message)
      .join("; ")}`;
    throw new ValidationError(complaint, { meta: { formErrors: [complaint] } });
  }
  throw err;
}

/** Installs the `aiTools.*` tRPC surface on a process root. */
export class AiToolsTrpcApi {
  static create<
    TContext extends AiToolsTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: AiToolsTrpcProcedures<TContext, TOptions, TRoot>,
  ) {
    const { protected: procedure, policy } = procedures;

    const view = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
      policy("aiTools:view")(procedure.input(schema));
    const manage = <TSchema extends z.ZodTypeAny>(schema: TSchema) =>
      policy("aiTools:manage")(procedure.input(schema));

    return trpc.router({
      /**
       * User-facing list — enabled non-archived entries the caller can see
       * (org-scoped + team-scoped, team overrides org by slug). Lazily
       * provisions the default catalog on a fresh org so the first portal
       * load renders tiles instead of the empty state; the zero-row guard
       * keeps admin-curated-empty catalogs untouched. Provisioning failures
       * are logged and swallowed — the list must keep serving whatever
       * exists, and the next load retries.
       */
      list: view(organizationScope).query(async ({ ctx, input }) => {
        try {
          await ctx.app.governance.aiToolEnsureDefaultCatalog({
            organizationId: input.organizationId,
          });
        } catch (error) {
          logger.warn(
            { err: error, organizationId: input.organizationId },
            "ai-tool default-catalog provisioning failed; serving existing rows",
          );
        }
        return ctx.app.governance.aiToolListForUser({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
        });
      }),

      /**
       * Per-org provider availability — drives the model_provider tile
       * preflight on /me. The tile compares its `config.providerKey` and
       * renders a "Provider not configured" hint when missing, instead of
       * silently minting a VK that 502s on the first curl.
       */
      providerAvailability: view(organizationScope).query(async ({ ctx, input }) => ({
        configuredProviders: await ctx.app.governance.aiToolListConfiguredProvidersForUser({
          organizationId: input.organizationId,
          userId: ctx.actor().id,
        }),
      })),

      /**
       * Auto-fill for the Claude Code coding-assistant tile: the OTLP
       * endpoint URL of an active `claude_code` IngestionSource. Discloses
       * ONLY the URL — no source name, scope or secret. The bearer token
       * gates the actual write, and the URL is publicly resolvable per
       * source-id anyway. Returns `endpoint: null` when the org hasn't
       * published a `claude_code` source yet; the tile then renders the
       * all-placeholder template.
       */
      claudeCodeOtlpEndpoint: view(organizationScope).query(async ({ ctx, input }) => {
        const source = (await ctx.app.governance.ingestionSourceList(input.organizationId))
          .filter(
            (candidate) =>
              candidate.sourceType === "claude_code" && candidate.status !== "disabled",
          )
          .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
        if (!source) return { endpoint: null };
        return { endpoint: `/api/ingest/otel/${source.id}` };
      }),

      /** Admin list — includes disabled (but not deleted) tiles. Powers the catalog editor. */
      adminList: manage(organizationScope).query(async ({ ctx, input }) =>
        ctx.app.governance.aiToolListForAdmin({
          organizationId: input.organizationId,
        }),
      ),

      get: manage(idAndOrg).query(async ({ ctx, input }) =>
        ctx.app.governance.aiToolGetById({
          id: input.id,
          organizationId: input.organizationId,
        }),
      ),

      create: manage(createSchema).mutation(async ({ ctx, input }) => {
        try {
          return await ctx.app.governance.aiToolCreate({
            organizationId: input.organizationId,
            departmentIds: input.departmentIds,
            type: input.type as (typeof AI_TOOL_TYPES)[number],
            displayName: input.displayName,
            iconAsset: input.iconAsset,
            order: input.order,
            config: input.config,
            actorUserId: ctx.actor().id,
          });
        } catch (err) {
          translateConfigValidationError(err, input.type);
        }
      }),

      update: manage(updateSchema).mutation(async ({ ctx, input }) => {
        try {
          return await ctx.app.governance.aiToolUpdate({
            id: input.id,
            organizationId: input.organizationId,
            displayName: input.displayName,
            iconAsset: input.iconAsset,
            departmentIds: input.departmentIds,
            order: input.order,
            enabled: input.enabled,
            type: input.type as (typeof AI_TOOL_TYPES)[number] | undefined,
            config: input.config,
            actorUserId: ctx.actor().id,
          });
        } catch (err) {
          translateConfigValidationError(err);
        }
      }),

      /**
       * Permanently delete a tile. Distinct from `setEnabled(false)`, which
       * only hides it: this drops the row so it disappears from the admin
       * editor and every member's portal.
       */
      remove: manage(idAndOrg).mutation(async ({ ctx, input }) =>
        ctx.app.governance.aiToolRemove({
          id: input.id,
          organizationId: input.organizationId,
        }),
      ),

      /**
       * Single-purpose enable / disable shorthand. Equivalent to
       * `update({ id, enabled })` but exists so the admin catalog editor's
       * per-row toggle has a clean intent-named mutation.
       */
      setEnabled: manage(setEnabledSchema).mutation(async ({ ctx, input }) =>
        ctx.app.governance.aiToolUpdate({
          id: input.id,
          organizationId: input.organizationId,
          enabled: input.enabled,
          actorUserId: ctx.actor().id,
        }),
      ),

      /**
       * "Import starter pack" — publishes the documented default tile set
       * (4 coding assistants + 4 model providers, all org-scoped) onto a
       * fresh org's catalog. Idempotent: re-imports skip slugs the admin
       * already has, so re-clicking after partial setup fills gaps without
       * duplicating or re-skinning hand-curated entries.
       */
      importStarterPack: manage(importStarterPackSchema).mutation(async ({ ctx, input }) =>
        ctx.app.governance.aiToolSeedStarterPack({
          organizationId: input.organizationId,
          actorUserId: ctx.actor().id,
          slugs: input.slugs,
        }),
      ),

      /**
       * Starter-pack catalog the admin editor renders as a checklist. Static
       * org-agnostic projection, gated on `aiTools:manage` to match the
       * editor's own access (only catalog admins ever see it).
       */
      starterPackCatalog: manage(organizationScope).query(() =>
        AI_TOOL_STARTER_TILES.map(({ slug, displayName, type }) => ({
          slug,
          displayName,
          type,
        })),
      ),

      /**
       * Admin drawer dropdown source for the model_provider tile's
       * `providerKey`. Returns every provider the org has any `ModelProvider`
       * row for, with a `configured: boolean` flag surfaced as a "Configure
       * provider →" hint when false. Wider than `providerAvailability`: an
       * admin needs every option they COULD expose, not only the live ones.
       */
      providerOptions: manage(organizationScope).query(async ({ ctx, input }) =>
        ctx.app.governance.aiToolListProviderOptionsForAdmin({
          organizationId: input.organizationId,
        }),
      ),

      /**
       * Admin drawer dropdown source for the model_provider tile's
       * `suggestedRoutingPolicyId`. Returns org-scoped routing policies
       * only — team-scoped policies are bound to a team's personal-VK flow
       * and are not surfaceable through a tile config.
       */
      routingPolicyOptions: manage(organizationScope).query(async ({ ctx, input }) =>
        ctx.app.governance.aiToolListRoutingPolicyOptionsForAdmin({
          organizationId: input.organizationId,
        }),
      ),

      reorder: manage(reorderSchema).mutation(async ({ ctx, input }) => {
        await ctx.app.governance.aiToolReorder({
          organizationId: input.organizationId,
          updates: input.updates,
        });
        return { ok: true };
      }),
    });
  }
}
