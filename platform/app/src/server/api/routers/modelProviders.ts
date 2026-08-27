import { auditLog } from "~/runtime/app/features/audit-log";
import { modelProviderTestConnectionInputSchema as testConnectionInputSchema } from "@langwatch/model-provider-contract";
import { declareAuthzMiddleware } from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import {
  SCOPE_TIERS,
  type ScopeAssignment,
  scopeAssignmentSchema,
} from "~/server/scopes/scope.types";
import { CodexAccountService } from "../../modelProviders/codexAccount.service";
import { customModelUpdateInputSchema } from "@langwatch/model-provider-contract";
import { assertCanManageAllScopes } from "../../modelProviders/modelProvider.authz";
import {
  validateKeyWithCustomUrl,
  validateProviderApiKey,
} from "../../modelProviders/providerValidation";
import {
  ROUTING_HANDLE_MAX_LENGTH,
  ROUTING_HANDLE_RULE,
} from "@langwatch/model-provider-contract";
import { checkOrganizationPermission, checkProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { CODEX_DEFAULT_MODEL, MODEL_ROLES } from "@langwatch/model-provider-contract";
export type { ModelMetadataForFrontend } from "./modelProviders.utils";
export {
  getModelMetadataForFrontend,
  getProjectModelProviders,
  getProjectModelProvidersForFrontend,
  mergeCustomModelMetadata,
  prepareEnvKeys,
  prepareLitellmParams,
} from "./modelProviders.utils";

type CanonicalProvider = {
  id: string;
  provider: string;
  enabled: boolean;
  customKeys: Record<string, unknown> | null;
  customModels: Array<{ id: string; label: string; type: string }>;
  customEmbeddingsModels: Array<{ id: string; label: string; type: string }>;
  models?: string[] | null;
  embeddingsModels?: string[] | null;
};

function toLegacyProvider(provider: CanonicalProvider) {
  return {
    id: provider.id,
    provider: provider.provider,
    enabled: provider.enabled,
    customKeys: provider.customKeys,
    deploymentMapping: null,
    models: provider.models ?? null,
    embeddingsModels: provider.embeddingsModels ?? null,
    customModels: provider.customModels.map((model) => ({
      modelId: model.id,
      displayName: model.label,
      mode: "chat" as const,
    })),
    customEmbeddingsModels: provider.customEmbeddingsModels.map((model) => ({
      modelId: model.id,
      displayName: model.label,
      mode: "embedding" as const,
    })),
  };
}

function toLegacyProviderMap(
  providers: Record<string, CanonicalProvider>,
  _includeKeys: boolean,
) {
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [key, toLegacyProvider(provider)]),
  );
}

function toCanonicalModels(value: unknown, type: "chat" | "embedding") {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((model) => {
    if (typeof model === "string") return [{ id: model, label: model, type }];
    if (!model || typeof model !== "object") return [];
    const item = model as { modelId?: unknown; displayName?: unknown };
    return typeof item.modelId === "string"
      ? [
          {
            id: item.modelId,
            label: typeof item.displayName === "string" ? item.displayName : item.modelId,
            type,
          },
        ]
      : [];
  });
}

/**
 * Shared input shape for the provider write paths: name the tenant with
 * either handle, and refuse a request that names neither. A create with
 * no project also has to say where the credential lands, since there is
 * no project to default the scope set from.
 */
const tenantAnchorSchema = {
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
};

function requireTenantAnchor(
  input: { projectId?: string; organizationId?: string },
  ctx: z.RefinementCtx,
) {
  if (!input.projectId && !input.organizationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either projectId or organizationId is required.",
      path: ["projectId"],
    });
  }
}

export const modelProviderRouter = createTRPCRouter({
  // tRPC responses land in the browser, so every query here must go
  // through the masking service method — decrypted customKeys are only
  // for server-internal callers of `getProjectModelProviders`.
  getAllForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      const { projectId } = input;

      const hasSetupPermission = await probeProjectPermission(
        ctx,
        projectId,
        "project:update",
      );

      const providers = await ctx.app.modelProviders.getForProject({ projectId });
      return toLegacyProviderMap(providers, hasSetupPermission);
    }),
  getAllForProjectForFrontend: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      const { projectId } = input;
      const hasSetupPermission = await probeProjectPermission(
        ctx,
        projectId,
        "project:update",
      );
      return toLegacyProviderMap(
        await ctx.app.modelProviders.getForProject({ projectId }),
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
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return (
        await ctx.app.modelProviders.listForProject({ projectId: input.projectId })
      ).map(toLegacyProvider);
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
    .permission("organization:view")
    .query(async ({ input, ctx }) => {
      return (
        await ctx.app.modelProviders.listForOrganization({
          organizationId: input.organizationId,
        })
      ).map(toLegacyProvider);
    }),
  update: protectedProcedure
    .input(
      z
        .object({
          id: z.string().optional(),
          ...tenantAnchorSchema,
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
          customEmbeddingsModels: customModelUpdateInputSchema.optional().nullable(),
          extraHeaders: z
            .array(z.object({ key: z.string(), value: z.string() }))
            .optional()
            .nullable(),
          defaultModel: z.string().optional(),
          // The slug that addresses THIS instance in a gateway model string
          // ("eu/claude-sonnet-5"). Omitted leaves the stored handle alone;
          // an empty string clears it. The length and the message both come
          // from the same module the service validates against, so the schema
          // cannot start accepting a handle the service will refuse. The shape
          // and the reserved names are checked in the service, which owns the
          // rule the gateway reads.
          routingHandle: z
            .string()
            .max(ROUTING_HANDLE_MAX_LENGTH, ROUTING_HANDLE_RULE)
            .optional()
            .nullable(),
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
        })
        .superRefine(requireTenantAnchor),
    )
    .use(checkProjectOrOrganizationPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      const result = await ctx.app.modelProviders.upsert({
        id: input.id,
        actorId: ctx.session.user.id,
        projectId: input.projectId,
        organizationId: input.organizationId,
        provider: input.provider,
        name: input.name,
        enabled: input.enabled,
        customKeys: input.customKeys as Record<string, unknown> | null | undefined,
        customModels: toCanonicalModels(input.customModels, "chat"),
        customEmbeddingsModels: toCanonicalModels(
          input.customEmbeddingsModels,
          "embedding",
        ),
        extraHeaders: input.extraHeaders,
        defaultModel: input.defaultModel,
        routingHandle: input.routingHandle,
        scopes:
          input.scopes ??
          (input.scopeType && input.scopeId
            ? [{ scopeType: input.scopeType, scopeId: input.scopeId }]
            : undefined),
        rateLimitRpm: input.rateLimitRpm,
        rateLimitTpm: input.rateLimitTpm,
        rateLimitRpd: input.rateLimitRpd,
        fallbackPriorityGlobal: input.fallbackPriorityGlobal,
        providerConfig: input.providerConfig as
          | Record<string, unknown>
          | null
          | undefined,
      });

      return toLegacyProvider(result);
    }),

  delete: protectedProcedure
    .input(
      z
        .object({
          id: z.string().optional(),
          ...tenantAnchorSchema,
          provider: z.string(),
        })
        .superRefine(requireTenantAnchor),
    )
    .use(checkProjectOrOrganizationPermission("project:delete"))
    .mutation(async ({ input, ctx }) => {
      return await ctx.app.modelProviders.delete({
        ...input,
        actorId: ctx.session.user.id,
      });
    }),

  /**
   * Validates an API key for a given model provider.
   *
   * A mutation despite changing nothing, because tRPC sends queries as GET
   * with their input encoded into the URL — and the input here is the
   * customer's API key. A secret in a URL is written to access logs, proxy
   * logs and browser history, and proxies that strip credential-shaped query
   * parameters leave the server parsing an absent input, which surfaces to
   * the customer as a validation error against a key that is perfectly good.
   * POSTing the key in a body avoids all of it.
   */
  validateApiKey: protectedProcedure
    .input(
      z
        .object({
          ...tenantAnchorSchema,
          provider: z.string(),
          customKeys: z.record(z.string(), z.string()),
          // The scopes the credential is being set up for. Required on the
          // no-project path, where they are what the probe is authorized
          // against — see checkProviderValidationPermission.
          scopes: z.array(scopeAssignmentSchema).min(1).optional(),
        })
        .superRefine(requireTenantAnchor),
    )
    .use(checkProviderValidationPermission())
    .mutation(async ({ input }) => {
      const { provider, customKeys } = input;
      return validateProviderApiKey(provider, customKeys);
    }),

  /**
   * Checks a credential that is already saved.
   *
   * A mutation despite reading rather than writing, for reasons the shape of
   * a query would defeat rather than merely fail to help. A query is a GET
   * that react-query refetches on window focus and replays from cache inside
   * `staleTime` — so a customer could read a verdict this page never asked
   * for, about a moment that has passed. And `ProviderUnreachableError` is a
   * 502, which the client's retry policy does not exclude, so one click at a
   * hanging provider would become five outbound requests. The same reasoning
   * is written out above for `validateApiKey`.
   *
   * The input carries a row id and no endpoint. See `testConnection` in the
   * service for why the absence is the point.
   */
  testConnection: protectedProcedure
    .input(testConnectionInputSchema.superRefine(requireTenantAnchor))
    .use(checkProjectOrOrganizationPermission("project:update"))
    .mutation(async ({ input, ctx }) => {
      return await ctx.app.modelProviders.testConnection({
        ...input,
        actorId: ctx.session.user.id,
      });
    }),

  /**
   * Codex sign-in, step 1: ask OpenAI for a device code. Nothing is stored —
   * the pending sign-in's identifiers travel to the client and come back on
   * every poll, so polling works across server instances.
   * Spec: specs/model-providers/codex-account-provider.feature
   */
  codexSignInStart: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:update")
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
    .permission("project:update")
    .mutation(async ({ input, ctx }) => {
      const codex = new CodexAccountService();
      const poll = await codex.pollDeviceSignIn({
        deviceAuthId: input.deviceAuthId,
        userCode: input.userCode,
      });
      if (poll.status === "pending") {
        return { status: "pending" as const };
      }

      const saved = await ctx.app.modelProviders.upsert({
        projectId: input.projectId,
        actorId: ctx.session.user.id,
        provider: "openai_codex",
        enabled: true,
        customKeys: poll.keys,
        scopes: input.scopes,
      });

      if (input.setAsCodingDefaults) {
        // The widest selected scope carries the defaults; role values
        // cascade down from it. One scope is the norm (the sign-in surfaces
        // pick the widest manageable), so this is scopes[0] in practice.
        // ROLE-level writes, not per-feature: Langy's own role plus the
        // Fast tier — the two roles whose whole feature set is
        // codex-licensed. The Default role (playground, evaluators,
        // workflows) is deliberately untouched.
        const scope = input.scopes[0]!;
        for (const role of ["LANGY", "FAST"] as const) {
          await ctx.app.modelProviders.setDefault({
            scope,
            key: role,
            model: CODEX_DEFAULT_MODEL,
            authorId: ctx.session?.user?.id ?? null,
            actorId: ctx.session?.user?.id,
          });
        }
      }

      // The response hands the connector their own account email (PII), so
      // the connect event is audit-logged: who, where, and which scopes. The
      // email itself deliberately stays out of the log row.
      void auditLog({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        action: "modelProvider.codexConnect",
        targetKind: "modelProvider",
        targetId: saved?.id,
        args: {
          scopes: input.scopes,
          setAsCodingDefaults: input.setAsCodingDefaults,
          plan: poll.keys.CODEX_PLAN,
        },
      });

      return {
        status: "complete" as const,
        providerId: saved?.id,
        email: poll.keys.CODEX_EMAIL,
        plan: poll.keys.CODEX_PLAN,
      };
    }),

  /**
   * Point the coding-assistant roles (LANGY + FAST) at the codex model,
   * after the fact. The settings-page connect flow doesn't write defaults
   * during sign-in; it asks with a dialog once connected and calls this on
   * "yes" — the same role writes the Langy/onboarding flows perform inline.
   */
  codexApplyCodingDefaults: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scopes: z.array(scopeAssignmentSchema).min(1),
      }),
    )
    .permission("project:update")
    .mutation(async ({ input, ctx }) => {
      const scope = input.scopes[0]!;
      for (const role of ["LANGY", "FAST"] as const) {
        await ctx.app.modelProviders.setDefault({
          scope,
          key: role,
          model: CODEX_DEFAULT_MODEL,
          authorId: ctx.session?.user?.id ?? null,
          actorId: ctx.session?.user?.id,
        });
      }
      void auditLog({
        userId: ctx.session.user.id,
        projectId: input.projectId,
        action: "modelProvider.codexApplyCodingDefaults",
        args: { scopes: input.scopes },
      });
      return { applied: true as const };
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
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return ctx.app.modelProviders.getCodexStatus(input);
    }),

  isManagedProvider: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        provider: z.string(),
      }),
    )
    .permission("organization:view")
    .query(({ input, ctx }) => {
      return {
        managed: ctx.app.modelProviders.isManagedProvider(input),
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
    .permission("project:update")
    .query(async ({ input, ctx }) => {
      const { projectId, provider, customBaseUrl } = input;
      return validateKeyWithCustomUrl({
        projectId,
        provider,
        customBaseUrl,
        modelProviders: ctx.app.modelProviders,
      });
    }),

  // ────────────────────────────────────────────────────────────────────────
  // Role + feature-keyed default models (Area B3.2). Writes go through
  // The canonical Model Provider service so they land in the new `ModelDefault`
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
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return ctx.app.modelProviders.tryGetResolvedDefault({
        projectId: input.projectId,
        featureKey: input.featureKey,
      });
    }),

  getDefaultModelsForProject: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return ctx.app.modelProviders.getDefaultSnapshot({
        projectId: input.projectId,
        actorId: ctx.session?.user?.id,
      });
    }),

  /**
   * Single-key writers used by the provider-create "Set as default"
   * flow and any tactical "change just this role at this scope" UI.
   * Both go through the canonical Model Provider service which finds the (newest)
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
    .mutation(async ({ input, ctx }) => {
      await ctx.app.modelProviders.setDefault({
        scope: { scopeType: input.scopeType, scopeId: input.scopeId },
        key: input.role,
        model: input.model,
        authorId: ctx.session?.user?.id ?? null,
        actorId: ctx.session?.user?.id,
      });
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
    .mutation(async ({ input, ctx }) => {
      await ctx.app.modelProviders.setDefault({
        scope: { scopeType: input.scopeType, scopeId: input.scopeId },
        key: input.featureKey,
        model: input.model,
        authorId: ctx.session?.user?.id ?? null,
        actorId: ctx.session?.user?.id,
      });
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
   * Either way the attached scopes are claimed exclusively: a scope
   * belongs to at most one config, so whichever config held one of
   * them before loses that attachment (and is deleted once nothing
   * keeps it alive). See the one-config-per-scope invariant in
   * specs/model-providers/model-default-config-cascade.feature.
   *
   * Scope-aware authz: the caller must hold the matching manage
   * permission on every scope they are attaching to OR removing from,
   * so a project admin can't silently push a default up to org level.
   */
  saveDefaultModelsConfig: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        config: z.record(z.string(), z.string()),
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
    .mutation(async ({ input, ctx }) => {
      const saved = await ctx.app.modelProviders.saveDefaultConfig({
        ...input,
        authorId: ctx.session?.user?.id ?? null,
        actorId: ctx.session?.user?.id,
      });
      return { id: saved.id };
    }),

  /**
   * Delete a config (and all its scope attachments cascade). The
   * caller must hold the matching manage permission on every scope
   * the config is currently attached to.
   */
  deleteDefaultModelsConfig: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.app.modelProviders.deleteDefaultConfig({
        id: input.id,
        actorId: ctx.session?.user?.id,
      });
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
    .permission("project:view")
    .query(async ({ input, ctx }) => {
      return ctx.app.modelProviders.getInheritedValues({
        projectId: input.projectId,
        scopes: input.scopes,
        excludeConfigId: input.excludeConfigId,
      });
    }),
});

/**
 * Tenant gate for a provider write that may arrive with either handle. A
 * provider belongs to an organization and reaches the scopes attached to
 * it, so a project is one valid way to name the tenant and the
 * organization is the other — an organization on the agent-governance
 * track has no project until it needs one, and organization scope is the
 * default for a new credential.
 *
 * With a project, this is the unchanged project permission check. Without
 * one, it falls back to organization membership, which establishes the
 * caller belongs to the tenant they named and nothing more. What the
 * caller may actually write is decided per scope by
 * `assertCanManageAllScopes` in the service, which is where organization
 * scope demands `organization:manage`, team demands `team:manage`, and
 * project demands `project:manage`. Same division of labour as
 * the canonical service's authorization dependency.
 */
function checkProjectOrOrganizationPermission(
  projectPermission: "project:update" | "project:delete",
) {
  const projectCheck = checkProjectPermission(projectPermission);
  const organizationCheck = checkOrganizationPermission("organization:view");
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the tenant anchor is data-dependent: a project when one is named, otherwise the organization",
      permissions: [projectPermission, "organization:view"],
    },
    async (params: {
      ctx: any;
      input: { projectId?: string; organizationId?: string };
      next: () => any;
    }) => {
      if (params.input.projectId) {
        return projectCheck({
          ...params,
          input: { ...params.input, projectId: params.input.projectId },
        });
      }
      if (!params.input.organizationId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either a project or an organization is required.",
        });
      }
      return organizationCheck({
        ...params,
        input: { ...params.input, organizationId: params.input.organizationId },
      });
    },
  );
}

/**
 * Tenant gate for the credential probe.
 *
 * Nothing downstream re-authorizes this one. The handler goes straight out
 * to the provider with caller-supplied keys and, for the `custom` provider,
 * a caller-supplied base URL, so whatever gate sits here IS the
 * authorization rather than a coarse pre-filter. Organization membership
 * would not do: `organization:view` is held by MEMBER and EXTERNAL, which
 * would turn a read-only seat into an arbitrary outbound request from our
 * servers.
 *
 * With a project this stays the pre-existing `project:update` check.
 * Without one it runs the same per-scope check the provider writes use, so
 * "may I probe a credential for this scope" is the same question, answered
 * by the same code, as "may I store a credential at this scope".
 */
function checkProviderValidationPermission() {
  const projectCheck = checkProjectPermission("project:update");
  return declareAuthzMiddleware(
    {
      kind: "custom",
      reason:
        "the credential probe authorizes against the scopes it is being set up for when no project is named",
      // Both paths the body can take: project:update when a project is named,
      // and the per-scope manage permissions assertCanManageAllScopes probes
      // when it is not (canManageScope in modelProvider.authz.ts).
      permissions: [
        "project:update",
        "project:manage",
        "team:manage",
        "organization:manage",
      ],
    },
    async (params: {
      ctx: any;
      input: {
        projectId?: string;
        organizationId?: string;
        scopes?: ScopeAssignment[];
      };
      next: () => any;
    }) => {
      if (params.input.projectId) {
        return projectCheck({
          ...params,
          input: { ...params.input, projectId: params.input.projectId },
        });
      }
      const scopes = params.input.scopes;
      if (!scopes || scopes.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Validating a credential without a project needs the scopes it is being set up for.",
        });
      }
      await assertCanManageAllScopes(
        { prisma: params.ctx.prisma, session: params.ctx.session },
        scopes,
      );
      params.ctx.permissionChecked = true;
      return params.next();
    },
  );
}
