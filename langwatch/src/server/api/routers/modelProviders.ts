import { z } from "zod";
import {
  SCOPE_TIERS,
  scopeAssignmentSchema,
} from "~/server/scopes/scope.types";
import { isManagedProvider } from "../../../../ee/managed-providers/managedBedrockConfig";
import { CodexAccountService } from "../../modelProviders/codexAccount.service";
import {
  CODEX_ALLOWED_FEATURE_KEYS,
  CODEX_DEFAULT_MODEL,
} from "../../modelProviders/codexRestrictions";
import { customModelUpdateInputSchema } from "../../modelProviders/customModel.schema";
import {
  featureByKey,
  MODEL_ROLES,
} from "../../modelProviders/featureRegistry";
import {
  getDefaultModelsSnapshot,
  getInheritedValuesForScopes,
  getResolvedDefaultForFeature,
} from "../../modelProviders/modelDefaults.read";
import {
  assertCanWriteScope,
  createConfig,
  deleteConfig,
  getScopeAttachmentsForConfig,
  setFeatureAtScope,
  setRoleAtScope,
  updateConfig,
} from "../../modelProviders/modelDefaults.service";
import { ModelProviderService } from "../../modelProviders/modelProvider.service";
import {
  checkOrganizationPermission,
  checkProjectPermission,
  hasProjectPermission,
} from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  getProjectModelProviders,
  getProjectModelProvidersForFrontend,
  listOrgModelProvidersForFrontend,
  listProjectModelProvidersForFrontend,
} from "./modelProviders.utils";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "./providerValidation";

export type { ModelMetadataForFrontend } from "./modelProviders.utils";
export {
  getModelMetadataForFrontend,
  getProjectModelProviders,
  getProjectModelProvidersForFrontend,
  mergeCustomModelMetadata,
  prepareEnvKeys,
  prepareLitellmParams,
} from "./modelProviders.utils";

export const modelProviderRouter = createTRPCRouter({
  // tRPC responses land in the browser, so every query here must go
  // through the masking service method — decrypted customKeys are only
  // for server-internal callers of `getProjectModelProviders`.
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;

      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );

      const service = ModelProviderService.create(ctx.prisma);
      return await service.getProjectModelProvidersForFrontend(
        projectId,
        hasSetupPermission,
      );
    }),
  getAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const hasSetupPermission = await hasProjectPermission(
        ctx,
        projectId,
        "project:update",
      );
      return await getProjectModelProvidersForFrontend(
        projectId,
        hasSetupPermission,
      );
    }),
  /**
   * List shape: one entry per stored ModelProvider row, no collapsing
   * by provider key. Use this for surfaces that need to render every
   * row (the settings page Model Providers table) rather than the
   * narrowest-scope-per-provider view returned by
   * `getAllForProjectForFrontend`. Multi-instance setups (e.g. two
   * "OpenAI" rows at different scopes) appear as two distinct entries.
   */
  listAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => {
      return await listProjectModelProvidersForFrontend(input.projectId);
    }),
  /**
   * Org-wide variant: returns every ModelProvider attached anywhere
   * inside the organization (org + every team + every project),
   * including env-fed pseudo-rows. The model-providers settings page
   * uses this for the "All you can see" view so an admin sees the
   * providers a sibling project's owner has configured.
   */
  listAllForOrganizationForFrontend: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .query(async ({ input }) => {
      return await listOrgModelProvidersForFrontend(input.organizationId);
    }),
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
        // Human-readable label shown in the settings list and the model
        // selector group headers. Defaults to the humanized provider name
        // (e.g. "openai" → "OpenAI") when omitted. Iter 109 added the
        // column; now exposing it on the write path so operators can
        // distinguish multiple same-provider instances at different
        // scopes.
        name: z.string().trim().min(1).max(128).optional(),
        enabled: z.boolean(),
        customKeys: z.object({}).passthrough().optional().nullable(),
        customModels: customModelUpdateInputSchema.optional().nullable(),
        customEmbeddingsModels: customModelUpdateInputSchema
          .optional()
          .nullable(),
        extraHeaders: z
          .array(z.object({ key: z.string(), value: z.string() }))
          .optional()
          .nullable(),
        defaultModel: z.string().optional(),
        // Multi-scope writes (iter 109). `scopes` is the canonical shape;
        // `scopeType`/`scopeId` remain for the transition period so older
        // callers still compile. When both arrive, `scopes` wins. The
        // service runs the fail-closed authz check on every entry before
        // persisting — any non-manageable scope aborts the whole write.
        scopes: z
          .array(scopeAssignmentSchema)
          .min(1, "At least one scope must be selected.")
          .optional(),
        scopeType: z.enum(SCOPE_TIERS).optional(),
        scopeId: z.string().optional(),
        // Advanced (Gateway) fields live on the same ModelProvider row.
        // Accepted on the unified write path so the drawer ships one Save
        // button across basic + advanced settings.
        rateLimitRpm: z.number().int().min(0).nullable().optional(),
        rateLimitTpm: z.number().int().min(0).nullable().optional(),
        rateLimitRpd: z.number().int().min(0).nullable().optional(),
        fallbackPriorityGlobal: z.number().int().nullable().optional(),
        providerConfig: z.object({}).passthrough().nullable().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const service = ModelProviderService.create(ctx.prisma);
      const result = await service.updateModelProvider(
        {
          id: input.id,
          projectId: input.projectId,
          provider: input.provider,
          name: input.name,
          enabled: input.enabled,
          customKeys: input.customKeys as
            | Record<string, unknown>
            | null
            | undefined,
          customModels: input.customModels,
          customEmbeddingsModels: input.customEmbeddingsModels,
          extraHeaders: input.extraHeaders,
          defaultModel: input.defaultModel,
          scopes: input.scopes,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          rateLimitRpm: input.rateLimitRpm,
          rateLimitTpm: input.rateLimitTpm,
          rateLimitRpd: input.rateLimitRpd,
          fallbackPriorityGlobal: input.fallbackPriorityGlobal,
          providerConfig: input.providerConfig as
            | Record<string, unknown>
            | null
            | undefined,
        },
        { prisma: ctx.prisma, session: ctx.session },
      );

      return result;
    }),

  delete: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        projectId: z.string(),
        provider: z.string(),
      }),
    )
    .use(checkProjectPermission("project:delete"))
    .mutation(async ({ input, ctx }) => {
      const service = ModelProviderService.create(ctx.prisma);
      return await service.deleteModelProvider(input, {
        prisma: ctx.prisma,
        session: ctx.session,
      });
    }),

  /**
   * Validates an API key for a given model provider.
   * This is a read-only query that tests if the provided API key works
   */
  validateApiKey: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        provider: z.string(),
        customKeys: z.record(z.string()),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input }) => {
      const { provider, customKeys } = input;
      return validateProviderApiKey(provider, customKeys);
    }),

  /**
   * Codex sign-in, step 1: ask OpenAI for a device code. Nothing is stored —
   * the pending sign-in's identifiers travel to the client and come back on
   * every poll, so polling works across server instances.
   * Spec: specs/model-providers/codex-account-provider.feature
   */
  codexSignInStart: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:update"))
    .mutation(async () => {
      const codex = new CodexAccountService();
      return await codex.startDeviceSignIn();
    }),

  /**
   * Codex sign-in, step 2..n: one poll of the pending device authorization.
   * While the user hasn't approved yet this returns `{ status: "pending" }`.
   * On approval it exchanges the code, saves the provider row with the
   * encrypted token set at the requested scopes (service authz fails closed
   * on any non-manageable scope), and — when the caller asks — writes the
   * coding-assistant defaults so Langy and the tiny assists start using the
   * account immediately.
   */
  codexSignInPoll: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        deviceAuthId: z.string(),
        userCode: z.string(),
        scopes: z.array(scopeAssignmentSchema).min(1),
        /** Langy setup + onboarding pass true: also point the allowed
         *  feature slots at the codex model. Settings passes false. */
        setAsCodingDefaults: z.boolean().default(false),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const codex = new CodexAccountService();
      const poll = await codex.pollDeviceSignIn({
        deviceAuthId: input.deviceAuthId,
        userCode: input.userCode,
      });
      if (poll.status === "pending") {
        return { status: "pending" as const };
      }

      const service = ModelProviderService.create(ctx.prisma);
      const saved = await service.updateModelProvider(
        {
          projectId: input.projectId,
          provider: "openai_codex",
          enabled: true,
          customKeys: poll.keys,
          scopes: input.scopes,
        },
        { prisma: ctx.prisma, session: ctx.session },
      );

      if (input.setAsCodingDefaults) {
        for (const scope of input.scopes) {
          await assertCanWriteScope(
            { prisma: ctx.prisma, session: ctx.session },
            scope.scopeType,
            scope.scopeId,
          );
        }
        // The widest selected scope carries the defaults; feature overrides
        // cascade down from it. One scope is the norm (the sign-in surfaces
        // pick the widest manageable), so this is scopes[0] in practice.
        const scope = input.scopes[0]!;
        for (const featureKey of CODEX_ALLOWED_FEATURE_KEYS) {
          await setFeatureAtScope(
            { prisma: ctx.prisma },
            {
              scopeType: scope.scopeType,
              scopeId: scope.scopeId,
              featureKey,
              model: CODEX_DEFAULT_MODEL,
              authorId: ctx.session?.user?.id ?? null,
            },
          );
        }
      }

      return {
        status: "complete" as const,
        providerId: saved?.id,
        email: poll.keys.CODEX_EMAIL,
        plan: poll.keys.CODEX_PLAN,
      };
    }),

  /**
   * The connected Codex account for a project, for the setup surfaces'
   * connected state. Never returns tokens, and deliberately NOT the account
   * email: this is a project:view query, so a plain member must not read the
   * (often personal) OpenAI address the connecting admin signed in with. The
   * plan tier is non-identifying. The connector still sees their own email at
   * connect time from the sign-in mutation's result.
   */
  codexStatus: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input }) => {
      const providers = await getProjectModelProviders(input.projectId);
      const row = providers.openai_codex;
      if (!row?.enabled) return { connected: false as const };
      const keys = (row.customKeys ?? {}) as Partial<Record<string, string>>;
      return {
        connected: true as const,
        providerId: row.id,
        plan: keys.CODEX_PLAN ?? "",
      };
    }),

  isManagedProvider: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        provider: z.string(),
      }),
    )
    .use(checkOrganizationPermission("organization:view"))
    .query(({ input }) => {
      return {
        managed: isManagedProvider(input.organizationId, input.provider),
      };
    }),

  /**
   * Validates a stored or env var API key against a custom or default base URL.
   * Gets API key from DB or env var and validates against the provided URL (or default if not provided).
   */
  validateKeyWithCustomUrl: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        provider: z.string(),
        customBaseUrl: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:update"))
    .query(async ({ input, ctx }) => {
      const { projectId, provider, customBaseUrl } = input;
      return validateKeyWithCustomUrl(
        projectId,
        provider,
        customBaseUrl,
        ctx.prisma,
      );
    }),

  // ────────────────────────────────────────────────────────────────────────
  // Role + feature-keyed default models (Area B3.2). Writes go through
  // Mario's `modelDefaults.service` so they land in the new `ModelDefault`
  // table; the legacy Organization/Team/Project scalar columns become
  // read-only fallback during the compat window.
  // See specs/model-providers/role-based-default-models.feature.
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Snapshot for the Default Models settings page.
   *
   * Shape mirrors RBAC: three effective default models for THIS
   * project at the top (the resolver's "what would I actually use
   * here" answer), then a flat list of `ModelDefaultConfig` rows —
   * each carrying its cascading JSON payload + the scopes it
   * attaches to. The UI groups, filters, or pivots this list itself
   * (per-scope drilldown is a client-side filter, not a separate
   * server call).
   *
   * `available` carries the scopes the caller can write to (RBAC-
   * filtered) so the drawer's chip picker can be the source of truth
   * without a redundant authz check.
   */
  /**
   * Cascade-resolve a single feature key for a project. Wraps
   * `resolveModelForFeature` for frontend consumers that used to read
   * `project.defaultModel` / etc directly. Returns null when nothing
   * is configured at any scope rather than throwing, so the caller can
   * render a placeholder selector + a "configure a default" hint
   * without an exception-based control flow.
   */
  getResolvedDefault: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        featureKey: z.string(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      return getResolvedDefaultForFeature(ctx, {
        projectId: input.projectId,
        featureKey: input.featureKey,
      });
    }),

  getDefaultModelsForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      return getDefaultModelsSnapshot(ctx, { projectId: input.projectId });
    }),

  /**
   * Single-key writers used by the provider-create "Set as default"
   * flow and any tactical "change just this role at this scope" UI.
   * Both go through modelDefaults.service which finds the (newest)
   * config attached at the scope and updates the matching key in
   * place, or creates a new config if none exists.
   *
   * Scope-aware authz: org needs organization:manage, team needs
   * team:manage, project needs project:update — same map the
   * provider update mutation uses.
   */
  setRoleAssignmentForScope: protectedProcedure
    .input(
      z.object({
        scopeType: z.enum(SCOPE_TIERS),
        scopeId: z.string(),
        role: z.enum(MODEL_ROLES),
        model: z.string().nullable(),
      }),
    )
    .use(scopeAwarePermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      await setRoleAtScope(
        { prisma: ctx.prisma },
        {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          role: input.role,
          model: input.model,
          authorId: ctx.session?.user?.id ?? null,
        },
      );
      return { ok: true };
    }),

  setFeatureOverrideForScope: protectedProcedure
    .input(
      z.object({
        scopeType: z.enum(SCOPE_TIERS),
        scopeId: z.string(),
        featureKey: z.string(),
        model: z.string().nullable(),
      }),
    )
    .use(scopeAwarePermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      if (!featureByKey(input.featureKey)) {
        throw new Error(`Unknown feature key: "${input.featureKey}".`);
      }
      await setFeatureAtScope(
        { prisma: ctx.prisma },
        {
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          featureKey: input.featureKey,
          model: input.model,
          authorId: ctx.session?.user?.id ?? null,
        },
      );
      return { ok: true };
    }),

  /**
   * Full-config writer: save (create or update) a whole policy
   * including its scope attachments. The drawer's "Save" button
   * funnels through here.
   *
   * - `id` omitted → create a new config.
   * - `id` provided → update that config's JSON + scope attachments.
   *
   * Scope-aware authz: the caller must hold the matching manage
   * permission on every scope they are attaching to OR removing from,
   * so a project admin can't silently push a default up to org level.
   */
  saveDefaultModelsConfig: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        config: z.record(z.string()),
        scopes: z
          .array(
            z.object({
              scopeType: z.enum(SCOPE_TIERS),
              scopeId: z.string().min(1),
            }),
          )
          .min(1, "Pick at least one scope."),
      }),
    )
    .use(saveConfigPermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      if (input.id) {
        await updateConfig(
          { prisma: ctx.prisma },
          {
            id: input.id,
            config: input.config,
            scopes: input.scopes,
            authorId: ctx.session?.user?.id ?? null,
          },
        );
        return { id: input.id };
      }
      const created = await createConfig(
        { prisma: ctx.prisma },
        {
          config: input.config,
          scopes: input.scopes,
          authorId: ctx.session?.user?.id ?? null,
        },
      );
      return { id: created.id };
    }),

  /**
   * Delete a config (and all its scope attachments cascade). The
   * caller must hold the matching manage permission on every scope
   * the config is currently attached to.
   */
  deleteDefaultModelsConfig: protectedProcedure
    .input(z.object({ id: z.string() }))
    .use(deleteConfigPermissionMiddleware)
    .mutation(async ({ input, ctx }) => {
      await deleteConfig({ prisma: ctx.prisma }, input.id);
      return { ok: true };
    }),

  /**
   * "What would the cascade hand back for these scopes if I had no
   * value here?" — drives the drawer's inherited-as-placeholder + the
   * "Inherit (from organization) [openai/gpt-5.5]" dropdown entry.
   *
   * The cascade walk is computed for the most-specific picked scope
   * (project beats team beats org), excluding any config attached to
   * the picked scopes themselves (and, when editing, optionally an
   * `excludeConfigId` so the in-progress draft is treated as "not
   * yet saved"). For each role + each registered feature key, the
   * response carries the model the cascade would resolve to + the
   * scope tier it came from.
   *
   * When the cascade has nothing AND there's a provider visible to
   * the caller that could fulfill a role, the response surfaces an
   * `inferred` suggestion from the registry's latest-flagship /
   * mini / embedding heuristic — same logic the onboarding seed
   * uses. The drawer can show this as the dropdown's first entry so
   * the user always has SOMETHING to pick, even on a brand-new
   * organization.
   */
  getInheritedValuesForScopes: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scopes: z
          .array(
            z.object({
              scopeType: z.enum(SCOPE_TIERS),
              scopeId: z.string().min(1),
            }),
          )
          .min(1, "Pick at least one scope."),
        excludeConfigId: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("project:view"))
    .query(async ({ input, ctx }) => {
      return getInheritedValuesForScopes(ctx, {
        projectId: input.projectId,
        scopes: input.scopes,
        excludeConfigId: input.excludeConfigId,
      });
    }),
});

/**
 * Permission middleware for the role/feature default writers. Each scope
 * demands its matching permission so a project admin can't silently push
 * a role default up to the organization scope. Matches the per-scope
 * permission map the existing model-providers update mutation uses.
 */
async function scopeAwarePermissionMiddleware({
  ctx,
  input,
  next,
}: {
  ctx: any;
  input: { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };
  next: () => Promise<unknown>;
}): Promise<unknown> {
  await assertCanWriteScope(ctx, input.scopeType, input.scopeId);
  ctx.permissionChecked = true;
  return next();
}

/**
 * Permission middleware for saveDefaultModelsConfig. Iterates every
 * scope in the desired attachment set + every scope being removed (on
 * an update) and asserts the caller can write each one. Setting
 * `ctx.permissionChecked = true` is required by the permission-builder
 * contract — without it `enforcePermissionCheck` throws.
 */
async function saveConfigPermissionMiddleware({
  ctx,
  input,
  next,
}: {
  ctx: any;
  input: {
    id?: string;
    scopes: Array<{
      scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
      scopeId: string;
    }>;
  };
  next: () => Promise<unknown>;
}): Promise<unknown> {
  for (const s of input.scopes) {
    await assertCanWriteScope(ctx, s.scopeType, s.scopeId);
  }
  if (input.id) {
    const existing = await getScopeAttachmentsForConfig(ctx, input.id);
    const desired = new Set(
      input.scopes.map((s) => `${s.scopeType}::${s.scopeId}`),
    );
    const removed = existing.filter(
      (e) => !desired.has(`${e.scopeType}::${e.scopeId}`),
    );
    for (const r of removed) {
      await assertCanWriteScope(ctx, r.scopeType, r.scopeId);
    }
  }
  ctx.permissionChecked = true;
  return next();
}

/**
 * Permission middleware for deleteDefaultModelsConfig. Reads the
 * config's current scope attachments and asserts the caller can write
 * each one — deleting a config the caller can't fully manage would
 * remove rules at scopes they don't own.
 */
async function deleteConfigPermissionMiddleware({
  ctx,
  input,
  next,
}: {
  ctx: any;
  input: { id: string };
  next: () => Promise<unknown>;
}): Promise<unknown> {
  const scopes = await getScopeAttachmentsForConfig(ctx, input.id);
  for (const s of scopes) {
    await assertCanWriteScope(ctx, s.scopeType, s.scopeId);
  }
  ctx.permissionChecked = true;
  return next();
}
