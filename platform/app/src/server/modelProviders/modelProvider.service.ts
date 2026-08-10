import type { PrismaClient, Project } from "@prisma/client";
import { z } from "zod";
import { env } from "~/env.mjs";
import type { Session } from "~/server/auth";
import { isManagedProvider } from "../../../ee/managed-providers/managedBedrockConfig";
import { MASKED_KEY_PLACEHOLDER } from "../../utils/constants";
import { getSchemaShape } from "../../utils/modelProviderHelpers";
import { rateLimit } from "../rateLimit";
import { isSecretCredential, mergeStoredCustomKeys } from "./credentialMerge";
import type { CustomModelsInput } from "./customModel.schema";
import { toLegacyCompatibleCustomModels } from "./customModel.schema";
import {
  ModelProviderAnchorRequiredError,
  ModelProviderCredentialsWouldBeDroppedError,
  ModelProviderDeprecatedError,
  ModelProviderNotFoundError,
  ModelProviderScopeForbiddenError,
  ModelProviderScopesRequiredError,
  ModelProviderTestRateLimitedError,
} from "./errors";
import { rowCannotServeEmbeddings } from "./geminiDoor";
import {
  assertCanManageAllScopes,
  canReadAnyScope,
} from "./modelProvider.authz";
import {
  ModelProviderRepository,
  type ModelProviderWithScopes,
  type ScopeInput,
} from "./modelProvider.repository";
import {
  type ValidationResult,
  validateProviderApiKey,
} from "./providerValidation";
import {
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders,
  providerDeprecation,
} from "./registry";
import { seedOnboardingDefaultsForProvider } from "./seedOnboardingDefaults";

/**
 * Minimal ctx slice this service uses to authorize scope-level writes.
 * Kept narrow so the service can be constructed from any caller (tRPC,
 * Hono routes, workers) without dragging the full tRPC Context in.
 */
export type AuthzContext = { prisma: PrismaClient; session: Session | null };

/**
 * A provider row this service materialized, as opposed to a form-time shape.
 *
 * `MaybeStoredModelProvider` leaves `scopes` optional because the same type
 * also describes a provider being filled in before it has any. Every row this
 * service hands out has them: stored rows map `mp.scopes`, and synthesized
 * system rows set `[]`. Saying so in the type is what lets the VK drawer
 * consume the list without a cast, and a cast there would be load-bearing in
 * the wrong direction, since `resolveEligible` iterates `provider.scopes`
 * unguarded.
 */
export type MaterializedModelProvider = MaybeStoredModelProvider & {
  scopes: NonNullable<MaybeStoredModelProvider["scopes"]>;
};

/**
 * Input types for service operations
 */
export type UpdateModelProviderInput = {
  id?: string;
  /**
   * Tenant anchor. A provider belongs to an organization and reaches the
   * scopes attached to it, so either handle identifies the tenant: a
   * project resolves to its organization, an organization is already one.
   * At least one is required, and callers with no project (an
   * organization on the agent-governance track has none until it needs
   * one) pass `organizationId` plus an explicit `scopes` set.
   */
  projectId?: string;
  organizationId?: string;
  name?: string;
  provider: string;
  enabled: boolean;
  customKeys?: Record<string, unknown> | null;
  customModels?: CustomModelsInput | null;
  customEmbeddingsModels?: CustomModelsInput | null;
  extraHeaders?: { key: string; value: string }[] | null;
  defaultModel?: string;
  /**
   * Full scope set for this credential. When omitted on create, defaults
   * to `[{ scopeType: "PROJECT", scopeId: projectId }]` for backward
   * compatibility, so it is required when there is no `projectId` to
   * default from; when omitted on update, the existing scope set is
   * preserved. Replace-all semantics: passing `[]` is rejected at the
   * router boundary.
   */
  scopes?: ScopeInput[];
  /**
   * Legacy single-scope inputs kept so existing form callers still
   * compile during the transition. When both `scopes` and these legacy
   * fields arrive, `scopes` wins; otherwise the pair is promoted to a
   * single-entry scope array.
   */
  scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId?: string;
  /**
   * Advanced gateway settings, persisted on the same ModelProvider row
   * as the basic fields so the drawer's single Save covers both.
   */
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  rateLimitRpd?: number | null;
  fallbackPriorityGlobal?: number | null;
  providerConfig?: Record<string, unknown> | null;
};

/**
 * What a connection test needs: which row, and which tenant to resolve it in.
 *
 * The schema is the source and the type is inferred from it, so the router's
 * runtime validation and the service's compile-time contract cannot drift —
 * and it lives here, beside the method that consumes it, so the service never
 * has to import the router to know its own input shape.
 *
 * `customKeys` carries the settings as they appear on screen, for the customer
 * who has changed an endpoint and wants to know about the endpoint they are
 * looking at rather than the one still in storage. They are used whole or not
 * at all — see `testConnection` for why combining them with what is stored is
 * the one thing this must never do.
 */
export const testConnectionInputSchema = z.object({
  modelProviderId: z.string(),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  customKeys: z.record(z.string()).optional(),
});

export type TestConnectionInput = z.infer<typeof testConnectionInputSchema>;

export type DeleteModelProviderInput = {
  id?: string;
  /** Same tenant anchor as `UpdateModelProviderInput`: one of the two. */
  projectId?: string;
  organizationId?: string;
  provider: string;
};

type AdvancedGatewayInput = {
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  rateLimitRpd?: number | null;
  fallbackPriorityGlobal?: number | null;
  providerConfig?: Record<string, unknown> | null;
};

/**
 * Refuse to act on a row that carries no scope grants.
 *
 * `assertCanManageAllScopes` answers "can you manage every one of these
 * scopes", which an empty list satisfies vacuously. The org-anchored
 * lookup finds rows by `(id, organizationId)` without a scope predicate,
 * so a scopeless row is reachable by id even though no listing query can
 * see it. Without this, the per-scope gate would wave such a row through
 * on the strength of having nothing to check.
 */
function assertRowCarriesScopes(row: { id: string; scopes: unknown[] }): void {
  if (row.scopes.length === 0) {
    throw new ModelProviderNotFoundError();
  }
}

/**
 * How many credential checks one organization may run per window, and how
 * many the whole instance may run.
 *
 * Two buckets rather than one. The per-organization budget is what keeps a
 * single tenant from turning the settings page into an outbound request
 * generator; the global one is what keeps a hundred tenants doing something
 * reasonable each from adding up to something that is not. Both are generous
 * against real use — a person checking their providers clicks a handful of
 * times — and tight against a loop.
 *
 * How hard a ceiling this is depends on the deployment. `rateLimit` counts in
 * Redis when one is configured and in a process-local map otherwise, so an
 * installation running several replicas without Redis gets these numbers per
 * replica rather than per fleet. That is worth knowing before reading either
 * figure as a guarantee; it is a property of the shared limiter, not of this
 * budget, and it bounds a handful of listing requests rather than anything
 * expensive.
 */
const TEST_CONNECTION_WINDOW_SECONDS = 60;
const TEST_CONNECTION_PER_ORGANIZATION = 20;
const TEST_CONNECTION_GLOBAL = 500;

async function assertTestConnectionWithinBudget(
  organizationId: string,
): Promise<void> {
  const perOrganization = await rateLimit({
    key: `model-provider-test:org:${organizationId}`,
    windowSeconds: TEST_CONNECTION_WINDOW_SECONDS,
    max: TEST_CONNECTION_PER_ORGANIZATION,
  });
  if (!perOrganization.allowed) {
    throw new ModelProviderTestRateLimitedError({
      retryAfterSeconds: retryAfterFrom(perOrganization.resetAt),
    });
  }

  const global = await rateLimit({
    key: "model-provider-test:global",
    windowSeconds: TEST_CONNECTION_WINDOW_SECONDS,
    max: TEST_CONNECTION_GLOBAL,
  });
  if (!global.allowed) {
    throw new ModelProviderTestRateLimitedError({
      retryAfterSeconds: retryAfterFrom(global.resetAt),
    });
  }
}

/** Whole seconds until the window resets, never below one. */
function retryAfterFrom(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
}

function pickAdvancedFields(input: AdvancedGatewayInput): AdvancedGatewayInput {
  const out: AdvancedGatewayInput = {};
  if (input.rateLimitRpm !== undefined) out.rateLimitRpm = input.rateLimitRpm;
  if (input.rateLimitTpm !== undefined) out.rateLimitTpm = input.rateLimitTpm;
  if (input.rateLimitRpd !== undefined) out.rateLimitRpd = input.rateLimitRpd;
  if (input.fallbackPriorityGlobal !== undefined) {
    out.fallbackPriorityGlobal = input.fallbackPriorityGlobal;
  }
  if (input.providerConfig !== undefined) {
    out.providerConfig = input.providerConfig;
  }
  return out;
}

/**
 * Whether this provider row serves `bareModel` through its effective
 * catalog: the provider's registry lists (`models` / `embeddingsModels` —
 * every row of a provider serves its registry models) plus the row's own
 * custom catalog (chat or embeddings). Registry models short-circuit to
 * true, so a collapse winner with no custom catalog is never mistaken
 * for "doesn't serve this model" and swapped away from the project's own
 * credentials. Accepts both the raw DB shape (legacy string[] or new
 * object[]) and the normalized `MaybeStoredModelProvider` lists; raw DB
 * rows carry no registry lists, so for them only the custom catalog
 * decides — the right question to ask of a candidate row for a
 * non-registry model.
 */
export function providerRowServesModel({
  row,
  bareModel,
}: {
  row: {
    models?: string[] | null;
    embeddingsModels?: string[] | null;
    customModels?: unknown;
    customEmbeddingsModels?: unknown;
  };
  bareModel: string;
}): boolean {
  if ((row.models ?? []).includes(bareModel)) return true;
  if ((row.embeddingsModels ?? []).includes(bareModel)) return true;
  const chat = toLegacyCompatibleCustomModels(row.customModels ?? null, "chat");
  const embeddings = toLegacyCompatibleCustomModels(
    row.customEmbeddingsModels ?? null,
    "embedding",
  );
  return chat.concat(embeddings).some((m) => m?.modelId === bareModel);
}

/**
 * Service layer for ModelProvider business logic.
 * Single Responsibility: Model provider lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class ModelProviderService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: ModelProviderRepository,
  ) {}

  /**
   * Static factory method for creating a ModelProviderService with proper DI.
   */
  static create(prisma: PrismaClient): ModelProviderService {
    const repository = new ModelProviderRepository(prisma);
    return new ModelProviderService(prisma, repository);
  }

  /**
   * Gets all model providers for a project, merging defaults with stored configurations.
   *
   * Business rules:
   * - Default providers from registry are included if they have enabledSince
   * - Stored providers override defaults
   * - Only includes stored providers with meaningful customizations
   */
  async getProjectModelProviders(
    projectId: string,
    includeKeys = true,
  ): Promise<Record<string, MaybeStoredModelProvider>> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const defaultModelProviders = this.buildDefaultProviders(project);
    const savedModelProviders = await this.buildSavedProviders(
      projectId,
      defaultModelProviders,
      includeKeys,
    );

    return {
      ...defaultModelProviders,
      ...savedModelProviders,
    };
  }

  /**
   * Gets model providers with API keys masked for frontend display.
   *
   * Business rules:
   * - Only masks customKeys fields matching KEY_CHECK patterns (API keys)
   * - Extra-header values are always masked — they routinely carry auth
   *   secrets for azure/custom providers
   * - URLs and other values remain visible
   *
   * Masking runs even when `includeKeys` is false: customKeys are already
   * nulled by that flag, but extraHeaders are returned regardless, so
   * skipping the mask would hand view-only users plaintext header values.
   */
  async getProjectModelProvidersForFrontend(
    projectId: string,
    includeKeys = true,
  ): Promise<Record<string, MaybeStoredModelProvider>> {
    const providers = await this.getProjectModelProviders(
      projectId,
      includeKeys,
    );

    return this.maskApiKeys(providers);
  }

  /**
   * List shape of every ModelProvider accessible to a project — one
   * entry per stored row, no collapsing by provider key. The page-level
   * Model Providers table needs this so it can render multi-instance
   * setups (e.g. "OpenAI — Org" + "OpenAI — Project override") as two
   * rows; the `Record<provider, …>` shape returned by
   * `getProjectModelProvidersForFrontend` silently drops the loser.
   *
   * API keys are masked.
   */
  async listProjectModelProvidersForFrontend(
    projectId: string,
  ): Promise<MaybeStoredModelProvider[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new Error("Project not found");

    const defaultProviders = this.buildDefaultProviders(project);
    const savedProviders =
      await this.repository.findAllAccessibleForProject(projectId);
    const savedProviderKeys = new Set(savedProviders.map((mp) => mp.provider));

    // Env-fed providers (process.env has the API key) that nobody has
    // stored a row for. They're real and usable — surface them as
    // pseudo-rows tagged `isSystem` so the settings table can render a
    // "SYSTEM" chip and the picker can include them without an edit
    // affordance. Skip ones that are also stored — the stored row
    // wins, and we don't want to double-show the same provider.
    const systemRows: MaybeStoredModelProvider[] = [];
    for (const [providerKey, provider_] of Object.entries(defaultProviders)) {
      if (savedProviderKeys.has(providerKey)) continue;
      if (!provider_.enabled) continue;
      systemRows.push({
        ...provider_,
        isSystem: true,
        scopes: [],
        embeddingsUnsupported: rowCannotServeEmbeddings({
          provider: providerKey,
          customKeys: null,
        }),
      });
    }

    const storedRows = savedProviders
      .filter((mp) => this.shouldKeepModelProvider(mp, defaultProviders))
      .map((mp) => ({
        ...this.toMaybeStoredProvider(mp, defaultProviders, true),
        customKeys: this.maskRowCustomKeys(mp.customKeys),
        extraHeaders: this.maskExtraHeaders(
          mp.extraHeaders as { key: string; value: string }[] | null,
        ),
        // Derived before masking: the door depends on the API key's
        // presence, which the masked shape still shows, but deriving it
        // here keeps the rule reading one row shape.
        embeddingsUnsupported: rowCannotServeEmbeddings({
          provider: mp.provider,
          customKeys: mp.customKeys,
        }),
      }));
    return [...storedRows, ...systemRows];
  }

  /**
   * Org-wide variant of `listProjectModelProvidersForFrontend`. Returns
   * every ModelProvider attached anywhere inside the organization — at
   * the org itself, any of its teams, or any of its projects. The
   * settings page renders this when the page-level filter is set to
   * "All you can see" so a user can see what an admin in a sibling
   * project has configured.
   *
   * Env-fed pseudo-rows (process.env API keys + managed bedrock
   * keyed by orgId) are included with scopes=[] / isSystem=true so the
   * "SYSTEM" chip renders correctly. The per-project env check
   * (enabledSince < project.createdAt) is anchored on the org's
   * oldest project — if any project in the org is old enough to see
   * the env-fed provider, all of them do, so the row shows once at
   * org scope.
   */
  /**
   * Both row shapes this returns always carry scopes: stored rows get them
   * from `toMaybeStoredProvider`, which maps `mp.scopes`, and synthesized
   * system rows set `scopes: []` explicitly. `MaybeStoredModelProvider`
   * leaves the field optional because the same type also describes form-time
   * shapes that have no scopes yet, so saying so here is what lets the VK
   * drawer consume this without a cast. The drawer's `resolveEligible`
   * iterates `provider.scopes` unguarded, so an optional field there is the
   * difference between a compile error and a runtime crash.
   */
  async listOrgModelProvidersForFrontend(
    organizationId: string,
  ): Promise<MaterializedModelProvider[]> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId },
      include: { projects: true },
    });
    const projects = teams.flatMap((t) => t.projects);
    const oldestProject = projects.reduce<Project | null>(
      (oldest, p) =>
        !oldest || p.createdAt < oldest.createdAt ? (p as Project) : oldest,
      null,
    );
    const defaultProviders = oldestProject
      ? this.buildDefaultProviders(oldestProject)
      : {};
    const savedProviders =
      await this.repository.findAllInOrganization(organizationId);
    const savedProviderKeys = new Set(savedProviders.map((mp) => mp.provider));

    const systemRows: MaterializedModelProvider[] = [];
    for (const [providerKey, provider_] of Object.entries(defaultProviders)) {
      if (savedProviderKeys.has(providerKey)) continue;
      if (!provider_.enabled) continue;
      systemRows.push({
        ...provider_,
        isSystem: true,
        scopes: [],
        embeddingsUnsupported: rowCannotServeEmbeddings({
          provider: providerKey,
          customKeys: null,
        }),
      });
    }
    // Managed bedrock: env var MANAGED_BEDROCK__<label>__<orgId> sets
    // up cross-account credentials for a specific org. Surface a SYSTEM
    // pseudo-row so the table shows the user where it's coming from.
    // Skip when bedrock is already represented (saved row OR a standard
    // env-fed pseudo-row pushed in the loop above).
    const bedrockAlreadyShown =
      savedProviderKeys.has("bedrock") ||
      systemRows.some((r) => r.provider === "bedrock");
    if (!bedrockAlreadyShown && isManagedProvider(organizationId, "bedrock")) {
      const defaultProvider = this.buildDefaultProvidersFromEnvShape(
        "bedrock",
        oldestProject,
      );
      if (defaultProvider) {
        systemRows.push({ ...defaultProvider, isSystem: true, scopes: [] });
      }
    }

    const storedRows = savedProviders
      .filter((mp) => this.shouldKeepModelProvider(mp, defaultProviders))
      .map((mp) => ({
        ...this.toMaybeStoredProvider(mp, defaultProviders, true),
        customKeys: this.maskRowCustomKeys(mp.customKeys),
        extraHeaders: this.maskExtraHeaders(
          mp.extraHeaders as { key: string; value: string }[] | null,
        ),
        embeddingsUnsupported: rowCannotServeEmbeddings({
          provider: mp.provider,
          customKeys: mp.customKeys,
        }),
      }));
    return [...storedRows, ...systemRows];
  }

  /**
   * Build a single default provider row for a specific providerKey.
   * Used by managed-bedrock pseudo-row synthesis, where the env-fed
   * gate is satisfied through the managed-providers config rather
   * than `process.env[apiKey]`.
   */
  private buildDefaultProvidersFromEnvShape(
    providerKey: string,
    referenceProject: Project | null,
  ): MaybeStoredModelProvider | null {
    if (!referenceProject) return null;
    const registry = modelProviders[providerKey as keyof typeof modelProviders];
    if (!registry?.enabledSince) return null;
    return {
      provider: providerKey,
      enabled: true,
      disabledByDefault: false,
      customKeys: null,
      models: getProviderModelOptions(providerKey, "chat").map((m) => m.value),
      embeddingsModels: getProviderModelOptions(providerKey, "embedding").map(
        (m) => m.value,
      ),
      deploymentMapping: null,
      extraHeaders: [],
    };
  }

  /**
   * Updates or creates a model provider.
   *
   * Business rules:
   * - Validates provider exists in registry
   * - Validates custom keys against provider schema
   * - Smart merging: preserves original keys when masked placeholder is sent
   * - Can optionally update project default model
   */
  /**
   * Authorizes a write that lands the given set of scope entries on a
   * ModelProvider. Every entry must pass the per-scope manage check; a
   * single failure rejects the entire operation (no partial apply).
   *
   * When `ctx` is omitted the check is skipped — that path is reserved
   * for migrations, workers, and other server-internal callers that
   * already have a trusted root context. tRPC routers and any other
   * user-driven entrypoint MUST pass ctx.
   */
  async updateModelProvider(
    input: UpdateModelProviderInput,
    ctx?: AuthzContext,
  ) {
    const {
      id,
      projectId,
      organizationId,
      provider,
      enabled,
      customKeys,
      customModels,
      customEmbeddingsModels,
      extraHeaders,
      defaultModel,
      name,
      rateLimitRpm,
      rateLimitTpm,
      rateLimitRpd,
      fallbackPriorityGlobal,
      providerConfig,
    } = input;

    if (!projectId && !organizationId) {
      throw new ModelProviderAnchorRequiredError("project_or_organization");
    }

    const advanced = {
      rateLimitRpm,
      rateLimitTpm,
      rateLimitRpd,
      fallbackPriorityGlobal,
      providerConfig,
    };

    // Validate provider exists
    if (!(provider in modelProviders)) {
      throw new Error("Invalid provider");
    }

    // Validate and clean custom keys
    const { validatedKeys, customKeysProvided } = this.validateAndCleanKeys(
      provider,
      customKeys,
    );

    // Find existing provider. Absent `id` means an explicit create — we
    // intentionally do NOT auto-match by (provider, projectId) here,
    // since that would clobber an existing row at a different scope when
    // a user adds a second instance of the same provider type.
    const existingProvider = await this.findExistingProvider({
      id,
      projectId,
      organizationId,
    });

    // When the caller supplied an `id` but no row resolves, the target
    // row was concurrently deleted or is not visible from this project.
    // Falling through to createNew would silently produce a brand-new
    // row in the caller's project instead of erroring; surface
    // NOT_FOUND so the client can refetch and retry.
    if (id && !existingProvider) {
      throw new ModelProviderNotFoundError();
    }

    // A deprecated provider accepts no NEW rows. The Add menu hides it,
    // but hiding a tile is not enforcement: a direct API call, an SDK, or
    // a stale frontend would keep minting rows under a provider whose
    // whole purpose is to reach zero, and the compatibility entry could
    // never be deleted. Keyed on there being no existing row, so editing,
    // disabling, re-scoping and deleting a stored row all stay open —
    // that is what keeps a deployment mid-fold from being stranded.
    const deprecation = providerDeprecation(provider);
    if (!existingProvider && deprecation) {
      throw new ModelProviderDeprecatedError({
        provider,
        replacement: deprecation.replacedBy,
      });
    }

    // Resolve input scope set. Callers may pass `scopes: [...]` directly,
    // or a single-scope pair via the legacy `scopeType`/`scopeId` fields.
    // When neither is given, defer to the create/update defaults.
    const scopes: ScopeInput[] | undefined =
      input.scopes ??
      (input.scopeType && input.scopeId
        ? [{ scopeType: input.scopeType, scopeId: input.scopeId }]
        : undefined);

    // Existing-scope authz, fail-closed. The id-based lookup above is
    // org-anchored (findByIdForOrganization) so the resolved row may be
    // bound to an ORGANIZATION or TEAM scope a project admin cannot
    // manage. Without this check, that admin could update an inherited
    // row by submitting `scopes: [{PROJECT, theirProjectId}]` — the
    // submitted-scopes check would pass, but the row they're touching
    // is one they have no rights on. Validate against the row's
    // *current* scopes before considering any incoming changes.
    if (ctx && existingProvider) {
      assertRowCarriesScopes(existingProvider);
      await assertCanManageAllScopes(
        ctx,
        existingProvider.scopes.map((s) => ({
          scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
          scopeId: s.scopeId,
        })),
      );
    }

    // Submitted-scope authz, fail-closed. Every (scopeType, scopeId) in
    // the target set must also pass the manage-permission check, so a
    // caller can't widen a row into a scope they don't control. A
    // single failure aborts the whole operation; partial-success cannot
    // silently rebind a credential the caller can't see.
    if (ctx && scopes) {
      await assertCanManageAllScopes(ctx, scopes);
    }

    // The scope set a brand-new row lands on. `scopes` is the caller's
    // choice; a caller that supplies none is on the legacy single-scope
    // path and gets the project it wrote through. With no project there
    // is nothing to default from, so the set has to be explicit.
    const createScopes: ScopeInput[] | undefined = existingProvider
      ? undefined
      : (scopes ??
        (projectId
          ? [{ scopeType: "PROJECT" as const, scopeId: projectId }]
          : undefined));

    if (!existingProvider && !createScopes) {
      throw new ModelProviderScopesRequiredError();
    }

    return await this.prisma.$transaction(async (tx) => {
      let result;

      if (existingProvider) {
        result = await this.updateExisting(
          existingProvider,
          {
            provider,
            enabled,
            name,
            scopes,
            customModels: customModels ?? [],
            customEmbeddingsModels: customEmbeddingsModels ?? [],
            extraHeaders: extraHeaders ?? [],
            advanced,
          },
          validatedKeys,
          customKeysProvided,
          tx,
        );
      } else {
        result = await this.createNew(
          {
            provider,
            enabled,
            name: name ?? this.deriveDefaultName(provider),
            scopes: createScopes!,
            customModels: customModels ?? undefined,
            customEmbeddingsModels: customEmbeddingsModels ?? undefined,
            extraHeaders: extraHeaders ?? [],
            advanced,
          },
          validatedKeys,
          customKeysProvided,
          tx,
        );

        // Onboarding seed: writes one role-level ModelDefault row per
        // role the provider can fulfill (DEFAULT / FAST / EMBEDDINGS),
        // at every scope the new credential is bound to. Strictly
        // additive — `seedOnboardingDefaultsForProvider` skips any
        // (scope, role) pair that already has a row, so enabling a
        // second provider later can't silently replace a user's
        // configured choice. Without this wiring the seed function is
        // dead code; the bug surfaces as a fresh org showing
        // "not configured" on every role despite having a provider
        // enabled. See
        // specs/model-providers/model-resolver-and-registry.feature.
        for (const scope of createScopes!) {
          await seedOnboardingDefaultsForProvider({
            prisma: tx as unknown as PrismaClient,
            provider,
            scopeType: scope.scopeType,
            scopeId: scope.scopeId,
          });
        }
      }

      // The legacy `defaultModel` parameter is accepted in the input
      // shape for backwards compatibility but no longer writes anywhere.
      // Default-model writes go through `setRoleAtScope` against
      // ModelDefaultConfig (see useProviderFormSubmit).
      void defaultModel;

      return result;
    });
  }

  /**
   * Upsert-by-provider-key path for the REST endpoint
   * `PUT /api/model-providers/:provider`. The REST contract identifies a
   * row by provider string within a project (legacy single-instance shape);
   * if a project-scoped row exists for that provider we update it,
   * otherwise we create one. The tRPC `update` procedure goes through the
   * id-based path and never lands here, so the multi-instance create flow
   * from the UI is unaffected.
   */
  async upsertByProviderKey(
    input: UpdateModelProviderInput & { projectId: string },
    ctx?: AuthzContext,
  ) {
    const existing = await this.repository.findByProvider(
      input.provider,
      input.projectId,
    );
    return await this.updateModelProvider({ ...input, id: existing?.id }, ctx);
  }

  /**
   * Humanized default name for a brand-new ModelProvider when the caller
   * didn't supply one. Mirrors the backfill in migration
   * 20260419230000. For collisions within an org the service auto-
   * suffixes at write time — that suffix logic is handled by the router
   * because it needs access to the organization id.
   */
  private deriveDefaultName(provider: string): string {
    const humanized: Record<string, string> = {
      openai: "OpenAI",
      anthropic: "Anthropic",
      gemini: "Gemini",
      azure: "Azure OpenAI",
      bedrock: "Bedrock",
      vertex_ai: "Vertex AI",
      deepseek: "DeepSeek",
      xai: "xAI",
      cerebras: "Cerebras",
      groq: "Groq",
      azure_safety: "Azure Safety",
      custom: "Custom (OpenAI-compatible)",
      cloudflare: "Cloudflare",
      mistral: "Mistral",
      cohere: "Cohere",
      fireworks_ai: "Fireworks AI",
    };
    return (
      humanized[provider] ??
      provider.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    );
  }

  /**
   * Deletes a model provider — a hard delete of the row and its encrypted
   * credentials (scope grants cascade). The settings list surfaces rows
   * granted at the org, team, or a sibling project, so the existence/authz
   * lookup is anchored to the caller's organization rather than the viewing
   * project; a PROJECT-scope lookup used to 404 an org-scoped provider that
   * was plainly visible in the list.
   *
   * Scope authz: the caller must hold the manage-permission on EVERY
   * current scope entry. A team-level admin cannot silently blow up an
   * org-shared credential from under an organization they don't
   * manage.
   */
  async deleteModelProvider(
    input: DeleteModelProviderInput,
    ctx?: AuthzContext,
  ) {
    const { id, projectId, provider } = input;

    if (!projectId && !input.organizationId) {
      throw new ModelProviderAnchorRequiredError("project_or_organization");
    }
    // Matching by provider string is the legacy project-shaped contract —
    // it asks for "this provider type in this project", which needs one.
    if (!id && !projectId) {
      throw new ModelProviderAnchorRequiredError("project");
    }

    const anchor = await this.resolveOrganizationAnchor({
      projectId,
      organizationId: input.organizationId,
    });

    if (ctx) {
      // Org-anchored lookup when we can resolve the tenant; otherwise fall
      // back to the legacy project-scope lookup so a missing project can't
      // widen the blast radius.
      const existing =
        id && anchor
          ? await this.repository.findByIdForOrganization(id, anchor)
          : id && projectId
            ? await this.repository.findById(id, projectId)
            : projectId
              ? await this.repository.findByProvider(provider, projectId)
              : null;
      if (!existing) {
        throw new ModelProviderNotFoundError();
      }
      assertRowCarriesScopes(existing);
      await assertCanManageAllScopes(
        ctx,
        existing.scopes.map((s) => ({
          scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
          scopeId: s.scopeId,
        })),
      );
    }

    if (id) {
      return await this.repository.delete(id);
    }
    return await this.repository.deleteByProvider(provider, projectId!);
  }

  /**
   * Checks a credential that is already saved, on demand.
   *
   * Distinct from the save-time probe in three ways, each of them load-bearing.
   *
   * It reads the credential out of storage — which is the point, since the form
   * deliberately never shows one back — and that is exactly what makes the
   * destination dangerous. A caller who can edit a provider may never have been
   * allowed to read its key, so a stored key posted to an address they chose
   * turns permission to edit into permission to extract. The rule that prevents
   * it is not "no endpoint from the caller" but something narrower and more
   * useful: **the two are never combined**. Either the settings come from the
   * row, or they come from the request, whole. Nothing is merged, so there is
   * no arrangement of inputs that pairs a stored secret with a chosen address.
   *
   * A credential supplied as the masked placeholder is therefore not a
   * credential: it fails the checkable test and the answer comes back as
   * unchecked, rather than being quietly swapped for the real one. That is what
   * a customer editing an endpoint without re-entering their key should get.
   *
   * Supplied settings still travel through the same vetted transport as the
   * save-time probe, so an address pointing somewhere private is refused before
   * anything is sent.
   *
   * It is anchored by id against the organization rather than looked up by
   * provider name inside a project. `findByProvider` matches PROJECT-scope
   * grants only, so the org- and team-scoped rows the settings list happily
   * displays would come back empty and be reported as having no credential.
   *
   * And it gates the way the delete path gates, with both guards. The
   * scope-carrying check is not redundant in front of the per-scope check:
   * `assertCanManageAllScopes` iterates the scope list, so an empty list
   * satisfies it vacuously, and the org-anchored lookup has no scope
   * predicate to stop such a row being addressed by id.
   */
  async testConnection({
    input,
    ctx,
  }: {
    input: TestConnectionInput;
    ctx: AuthzContext;
  }): Promise<ValidationResult> {
    const { modelProviderId, projectId, organizationId, customKeys } = input;

    const anchor = await this.resolveOrganizationAnchor({
      projectId,
      organizationId,
    });
    if (!anchor) {
      throw new ModelProviderAnchorRequiredError("project_or_organization");
    }

    const existing = await this.repository.findByIdForOrganization(
      modelProviderId,
      anchor,
    );
    if (!existing) {
      throw new ModelProviderNotFoundError();
    }

    assertRowCarriesScopes(existing);
    await assertCanManageAllScopes(
      ctx,
      existing.scopes.map((s) => ({
        scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: s.scopeId,
      })),
    );

    // After authz, before the outbound request: a caller who cannot manage
    // the row should be refused rather than throttled, and no amount of
    // clicking should turn this page into an egress amplifier. The
    // organization is the unit that matters — rows multiply freely across
    // provider types and projects, so a per-row budget caps nothing.
    await assertTestConnectionWithinBudget(anchor);

    // Whole or not at all. A spread of one over the other would read as
    // helpful — fill in the fields the customer did not retype — and would be
    // the exfiltration path: a chosen endpoint plus a stored key. There is no
    // arrangement of inputs that reaches that combination from here.
    const keysToCheck =
      customKeys ?? ((existing.customKeys ?? {}) as Record<string, string>);

    // The provider is the row's, never the caller's. Otherwise a credential
    // could be checked under another provider's auth shape and endpoint.
    return await validateProviderApiKey(existing.provider, keysToCheck);
  }

  /**
   * Checks a credential the customer has just typed, before it is stored.
   *
   * The sibling above checks one already saved. This one never reads storage:
   * the credential arrives with the call, so there is nothing to escalate and
   * no row to authorize against — the caller's permission over the scopes the
   * credential is being set up for is settled by the route's own guard.
   *
   * What it does share is the budget, and that is the reason it exists as a
   * service method rather than staying a direct call from the route. Both ways
   * of asking end in the same outbound request, so counting one and not the
   * other means the uncounted one is the whole limit. That was survivable
   * while this route could only be reached by saving — a refusal arms a gate
   * that lets the next save through unprobed, so nobody could sit on it — and
   * stops being survivable the moment a control checks without saving.
   *
   * The organization the budget is charged to has to be one the caller can
   * actually reach, and that needs asserting here rather than assumed. When a
   * project anchors the call the route has already authorized it, so the
   * organization derived from it is trustworthy. When nothing but an
   * organization handle arrives, it is a value the caller chose: left
   * unchecked, naming someone else's organization spends *their* budget, which
   * both hands the caller an unlimited supply of fresh buckets and denies the
   * real owner a control they are entitled to.
   */
  async validateCredential({
    input,
    ctx,
  }: {
    input: {
      projectId?: string;
      organizationId?: string;
      provider: string;
      customKeys: Record<string, string>;
    };
    ctx: AuthzContext;
  }): Promise<ValidationResult> {
    const anchor = await this.resolveOrganizationAnchor({
      projectId: input.projectId,
      organizationId: input.organizationId,
    });
    if (!anchor) {
      throw new ModelProviderAnchorRequiredError("project_or_organization");
    }

    // Only the caller-supplied path needs the check: an anchor derived from a
    // project came through the route's project permission gate to get here.
    //
    // Membership, not authority. Charging an organization's budget is not an
    // act of administration — the whole point of this path is scopes below the
    // organization, where a team admin sets up a team-scoped credential and
    // never holds organization:manage. Demanding it would refuse them a check
    // the route had already authorized. Being able to see the organization at
    // all is what a stranger cannot fake, and that is exactly the line this
    // has to draw.
    if (!input.projectId) {
      const belongs = await canReadAnyScope(ctx, [
        { scopeType: "ORGANIZATION", scopeId: anchor },
      ]);
      if (!belongs) {
        throw new ModelProviderScopeForbiddenError({
          scopeType: "ORGANIZATION",
          requiredPermission: "organization:view",
        });
      }
    }

    await assertTestConnectionWithinBudget(anchor);

    return await validateProviderApiKey(input.provider, input.customKeys);
  }

  /**
   * Resolves the organization a project belongs to (via its team). Returns
   * null when the project can't be found, letting callers fall back to a
   * project-scoped path instead of widening access.
   */
  private async resolveProjectOrganizationId(
    projectId: string,
  ): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { team: { select: { organizationId: true } } },
    });
    return project?.team?.organizationId ?? null;
  }

  /**
   * Scope-aware read gate for getById. Returns the row when the caller
   * can see any of its scope entries, otherwise surfaces NOT_FOUND so
   * clients can't probe ids across tenants.
   */
  async getById(
    id: string,
    projectId: string,
    ctx: AuthzContext,
  ): Promise<ModelProviderWithScopes> {
    // Org-anchored, for the same reason the edit path is (see
    // `findEditableById`): `findById` matches only rows carrying a PROJECT
    // scope for this project, so an ORGANIZATION- or TEAM-scoped provider —
    // which the settings list surfaces here by inheritance — resolved to null
    // and 404'd. Worse, it made the read gate below unreachable for exactly
    // the scopes it exists to judge: a row that never loads is never asked
    // about.
    //
    // Two boundaries, both load-bearing, and neither substitutes for the
    // other: `findByIdForOrganization` is the TENANT boundary — it cannot
    // return a row belonging to another organization — and `canReadAnyScope`
    // below is the SCOPE-VISIBILITY boundary, deciding whether this caller may
    // see this row within that tenant. Widening the lookup is only safe
    // because the second one exists; do not drop either.
    //
    // Falls back to the project lookup when the tenant can't be resolved, so
    // a missing project can't widen the blast radius.
    const anchor = await this.resolveOrganizationAnchor({ projectId });
    const existing = anchor
      ? await this.repository.findByIdForOrganization(id, anchor)
      : await this.repository.findById(id, projectId);
    if (!existing) {
      throw new ModelProviderNotFoundError();
    }
    const readable = await canReadAnyScope(
      ctx,
      existing.scopes.map((s) => ({
        scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: s.scopeId,
      })),
    );
    if (!readable) {
      throw new ModelProviderNotFoundError();
    }
    return existing;
  }

  // ─────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────

  private buildDefaultProviders(
    project: Project,
  ): Record<string, MaybeStoredModelProvider> {
    return Object.fromEntries(
      Object.entries(modelProviders)
        .filter(([_, modelProvider]) => modelProvider.enabledSince)
        .map(([providerKey, modelProvider]) => {
          // Auto-enable from host env vars only when running in SaaS mode.
          // In SaaS, the platform's `ANTHROPIC_API_KEY` (etc.) is the
          // shared platform key that every org tenant inherits — that's
          // the intended product behavior. In self-hosted, the host
          // `.env` keys belong to whoever installed the deployment and
          // should NOT silently leak into every fresh org as "already
          // configured" (G79: Ariana's fresh-org Anthropic edit drawer
          // pre-populated the API-key field with masked dots, making the
          // admin think their org had a key when they didn't).
          //
          // Self-hosted operators who DO want global env-key sharing can
          // still set `IS_SAAS=true` explicitly; the default is the
          // safer multi-tenant isolation.
          const enabled =
            env.IS_SAAS === true &&
            modelProvider.enabledSince! < project.createdAt &&
            !!process.env[modelProvider.apiKey] &&
            (providerKey !== "vertex_ai" || !!process.env.VERTEXAI_PROJECT);

          const provider_: MaybeStoredModelProvider = {
            provider: providerKey,
            enabled,
            disabledByDefault: !enabled,
            customKeys: null,
            models: getProviderModelOptions(providerKey, "chat").map(
              (m) => m.value,
            ),
            embeddingsModels: getProviderModelOptions(
              providerKey,
              "embedding",
            ).map((m) => m.value),
            deploymentMapping: null,
            extraHeaders: [],
          };
          return [providerKey, provider_];
        }),
    );
  }

  private async buildSavedProviders(
    projectId: string,
    defaultProviders: Record<string, MaybeStoredModelProvider>,
    includeKeys: boolean,
  ): Promise<Record<string, MaybeStoredModelProvider>> {
    // Walk the multi-scope access relation: every MP whose scope set
    // intersects the project's (projectId, teamId, organizationId) is
    // returned. When the same provider string appears multiple times
    // (e.g. an ORG row and a PROJECT override), an enabled row beats a
    // disabled one, then narrower-scope wins for the legacy
    // `Record<provider, …>` shape we still return here — new consumers
    // that need the full list should call
    // `listProjectModelProvidersForFrontend` directly on the service.
    const savedProviders =
      await this.repository.findAllAccessibleForProject(projectId);

    return savedProviders
      .filter((mp) => this.shouldKeepModelProvider(mp, defaultProviders))
      .reduce(
        (acc, mp) => {
          const provider_ = this.toMaybeStoredProvider(
            mp,
            defaultProviders,
            includeKeys,
          );

          // Collapse rules when the same provider string has multiple
          // accessible rows: an enabled row beats a disabled one, then
          // narrower scope wins (preserves iter 107/108 semantics for
          // the Record<provider, …> consumers).
          const existing = acc[mp.provider];
          if (!existing || this.isNarrower(provider_, existing)) {
            return { ...acc, [mp.provider]: provider_ };
          }
          return acc;
        },
        {} as Record<string, MaybeStoredModelProvider>,
      );
  }

  /** Map a stored row to the `MaybeStoredModelProvider` shape consumers
   * expect: registry models for models/embeddingsModels, normalized
   * custom lists, and the narrowest scope surfaced as scopeType/scopeId. */
  private toMaybeStoredProvider(
    mp: ModelProviderWithScopes,
    defaultProviders: Record<string, MaybeStoredModelProvider>,
    includeKeys: boolean,
  ): MaterializedModelProvider {
    // Always use registry models for models/embeddingsModels
    const defaultProvider = defaultProviders[mp.provider];

    // Convert DB custom models (may be legacy string[] or new object[])
    const customModels = toLegacyCompatibleCustomModels(
      mp.customModels,
      "chat",
    );
    const customEmbeddingsModels = toLegacyCompatibleCustomModels(
      mp.customEmbeddingsModels,
      "embedding",
    );

    const narrowestScope = this.pickNarrowestScope(mp.scopes);

    return {
      id: mp.id,
      name: mp.name,
      provider: mp.provider,
      enabled: mp.enabled,
      // Whether the credential has been withdrawn. The gateway already
      // refuses to route to a withdrawn provider; surfacing it lets the
      // frontend surfaces that preview routing agree with that decision
      // instead of advertising reach the key does not have.
      disabledAt: mp.disabledAt,
      customKeys: includeKeys ? mp.customKeys : null,
      models: defaultProvider?.models ?? null,
      embeddingsModels: defaultProvider?.embeddingsModels ?? null,
      customModels: customModels.length > 0 ? customModels : null,
      customEmbeddingsModels:
        customEmbeddingsModels.length > 0 ? customEmbeddingsModels : null,
      deploymentMapping: mp.deploymentMapping,
      disabledByDefault: defaultProvider?.disabledByDefault,
      extraHeaders: mp.extraHeaders as { key: string; value: string }[] | null,
      scopes: mp.scopes.map((s) => ({
        scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: s.scopeId,
      })),
      scopeType: narrowestScope.scopeType,
      scopeId: narrowestScope.scopeId,
    };
  }

  /** Mask key-bearing fields of a row's customKeys for frontend display,
   * leaving URLs and other non-secret values visible. The same test decides
   * what `mergeStoredCustomKeys` keeps on a write that leaves a field out:
   * what we never show back is what a caller cannot resend. */
  private maskRowCustomKeys(
    customKeys: unknown,
  ): MaybeStoredModelProvider["customKeys"] {
    if (!customKeys) return null;
    return Object.fromEntries(
      Object.entries(customKeys as Record<string, unknown>).map(
        ([key, value]) => [
          key,
          isSecretCredential(key) ? MASKED_KEY_PLACEHOLDER : value,
        ],
      ),
    ) as MaybeStoredModelProvider["customKeys"];
  }

  /**
   * The accessible row that actually serves `bareModel` for this provider
   * key: the narrowest-scope ENABLED row whose custom catalog (chat or
   * embeddings) lists the model. Null when no enabled row lists it —
   * callers then keep the scope-collapse winner, which also covers
   * registry-model providers whose rows list nothing custom.
   *
   * Why this exists: with multi-instance providers the default-models
   * picker offers the union of every accessible row's catalog, so a
   * configured default may only be served by a wider-scope row than the
   * collapse winner. Executing it against the narrower row's credentials
   * targets a deployment that doesn't exist there (Azure answers 404
   * "Resource not found"). See
   * specs/model-providers/scope-and-multi-instance.feature ("Runtime
   * provider-row selection follows the model").
   */
  async findRowServingModel(params: {
    projectId: string;
    provider: string;
    bareModel: string;
  }): Promise<MaybeStoredModelProvider | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: params.projectId },
      include: { team: { select: { organizationId: true } } },
    });
    if (!project) return null;

    const defaultProviders = this.buildDefaultProviders(project);
    const rows = await this.repository.findAllAccessibleForProject(
      params.projectId,
    );

    const candidates = rows.filter(
      (mp) =>
        mp.provider === params.provider &&
        mp.enabled &&
        providerRowServesModel({ row: mp, bareModel: params.bareModel }),
    );
    if (candidates.length === 0) return null;

    // Rank by the scope that grants THIS project access to the row — a
    // multi-scope row's attachment to some other project's scope must not
    // inflate its specificity here (that scope grants nothing to us).
    const chain = {
      projectId: project.id,
      teamId: project.teamId,
      organizationId: project.team?.organizationId ?? null,
    };
    // Deterministic order within the same tier: fallbackPriorityGlobal
    // ASC (nulls last) then createdAt ASC — two same-tier rows both
    // serving the model must not route by the DB's unspecified row
    // order.
    const sorted = [...candidates].sort((a, b) => {
      const tier =
        this.chainSpecificity(b.scopes, chain) -
        this.chainSpecificity(a.scopes, chain);
      if (tier !== 0) return tier;
      const aPriority = a.fallbackPriorityGlobal ?? Number.MAX_SAFE_INTEGER;
      const bPriority = b.fallbackPriorityGlobal ?? Number.MAX_SAFE_INTEGER;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return this.toMaybeStoredProvider(sorted[0]!, defaultProviders, true);
  }

  /**
   * Specificity of a row RELATIVE to a project's scope chain: the highest
   * tier among the row's attachments that actually grant this project
   * access (its own PROJECT scope > its TEAM > its ORGANIZATION).
   * Attachments outside the chain — e.g. another project's PROJECT scope
   * on a shared row — contribute nothing.
   */
  private chainSpecificity(
    scopes: { scopeType: string; scopeId: string }[],
    chain: {
      projectId: string;
      teamId: string | null;
      organizationId: string | null;
    },
  ): number {
    let best = 0;
    for (const s of scopes) {
      if (s.scopeType === "PROJECT" && s.scopeId === chain.projectId) {
        best = Math.max(best, 3);
      } else if (s.scopeType === "TEAM" && s.scopeId === chain.teamId) {
        best = Math.max(best, 2);
      } else if (
        s.scopeType === "ORGANIZATION" &&
        s.scopeId === chain.organizationId
      ) {
        best = Math.max(best, 1);
      }
    }
    return best;
  }

  private scopePriority(
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT" | undefined,
  ): number {
    if (scopeType === "PROJECT") return 3;
    if (scopeType === "TEAM") return 2;
    if (scopeType === "ORGANIZATION") return 1;
    return 0;
  }

  private pickNarrowestScope(
    scopes: { scopeType: string; scopeId: string }[],
  ): { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string } {
    if (scopes.length === 0) {
      return { scopeType: "PROJECT", scopeId: "" };
    }
    const sorted = [...scopes].sort(
      (a, b) =>
        this.scopePriority(b.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT") -
        this.scopePriority(a.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT"),
    );
    return {
      scopeType: sorted[0]!.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
      scopeId: sorted[0]!.scopeId,
    };
  }

  private isNarrower(
    a: MaybeStoredModelProvider,
    b: MaybeStoredModelProvider,
  ): boolean {
    // Prefer an enabled row over a disabled one, regardless of scope.
    // A disabled narrower-scope row must not mask an enabled wider-scope
    // one — otherwise `hasEnabledProviders` on the frontend gates off
    // Ask AI even though an enabled row exists at a wider scope (#5575).
    if (a.enabled !== b.enabled) {
      return a.enabled;
    }
    // Same enabled state: narrower scope wins (preserves iter 107/108
    // semantics for the Record<provider, …> consumers).
    return this.scopePriority(a.scopeType) > this.scopePriority(b.scopeType);
  }

  /**
   * Determines if a stored provider should be included in results.
   * Filters out providers that don't have meaningful customizations.
   */
  private shouldKeepModelProvider(
    mp: {
      customKeys: unknown;
      provider: string;
      enabled: boolean;
      customModels: unknown;
      customEmbeddingsModels: unknown;
    },
    defaultProviders: Record<string, MaybeStoredModelProvider>,
  ): boolean {
    // Keep if has custom keys
    if (mp.customKeys) return true;

    // Keep if enabled status differs from default
    const defaultProvider = defaultProviders[mp.provider];
    if (mp.enabled !== defaultProvider?.enabled) return true;

    // Keep if has custom models or embeddings (works for both string[] and object[])
    const customModels = mp.customModels as unknown[] | null;
    const customEmbeddings = mp.customEmbeddingsModels as unknown[] | null;

    return (
      (customModels != null && customModels.length > 0) ||
      (customEmbeddings != null && customEmbeddings.length > 0)
    );
  }

  private maskApiKeys(
    providers: Record<string, MaybeStoredModelProvider>,
  ): Record<string, MaybeStoredModelProvider> {
    const masked = { ...providers };

    for (const [providerKey, config] of Object.entries(masked)) {
      if (config.customKeys || config.extraHeaders?.length) {
        masked[providerKey] = {
          ...config,
          customKeys: this.maskRowCustomKeys(config.customKeys),
          extraHeaders: this.maskExtraHeaders(config.extraHeaders),
        };
      }
    }

    return masked;
  }

  /**
   * Header values are masked wholesale — unlike customKeys there is no
   * name pattern to distinguish secrets, and azure/custom extra headers
   * routinely carry auth tokens. Keys stay visible so the form can be
   * edited; `mergeExtraHeaders` restores real values when the masked
   * placeholder comes back on save.
   */
  private maskExtraHeaders(
    extraHeaders: { key: string; value: string }[] | null | undefined,
  ): { key: string; value: string }[] | null {
    if (extraHeaders == null) return null;
    return extraHeaders.map(({ key }) => ({
      key,
      value: MASKED_KEY_PLACEHOLDER,
    }));
  }

  private validateAndCleanKeys(
    provider: string,
    customKeys: Record<string, unknown> | null | undefined,
  ): {
    validatedKeys: Record<string, unknown> | null;
    customKeysProvided: boolean;
  } {
    const customKeysProvided = customKeys !== undefined;

    if (!customKeys) {
      return { validatedKeys: null, customKeysProvided };
    }

    const providerSchema =
      modelProviders[provider as keyof typeof modelProviders]!.keysSchema;
    const validator = z.union([
      providerSchema,
      z.object({ MANAGED: z.string() }),
    ]);

    let validatedKeys: Record<string, unknown>;
    try {
      validatedKeys = validator.parse(customKeys);
    } catch {
      throw new Error(
        `Invalid API key configuration for ${provider}. Please verify your credentials.`,
      );
    }

    // Filter out null values for Azure provider
    if (provider === "azure" && validatedKeys) {
      validatedKeys = Object.fromEntries(
        Object.entries(validatedKeys).filter(([_, value]) => value !== null),
      );
      if (Object.keys(validatedKeys).length === 0) {
        return { validatedKeys: null, customKeysProvided };
      }
    }

    return { validatedKeys, customKeysProvided };
  }

  /**
   * Look up the existing row a write targets. When the caller supplies an
   * `id`, that's an explicit edit. When `id` is absent, this is an explicit
   * create: returning `null` here lets `updateModelProvider` go straight to
   * `createNew` instead of falling through to a scope-blind
   * `findByProvider` match that silently clobbers the first existing row
   * of the same provider type (the multi-instance override bug). The
   * REST upsert-by-provider-key entrypoint uses
   * `upsertByProviderKey` below, not this code path.
   */
  private async findExistingProvider({
    id,
    projectId,
    organizationId,
  }: {
    id: string | undefined;
    projectId?: string;
    organizationId?: string;
  }) {
    if (!id) return null;
    // Org-anchored lookup so an edit from a project view resolves providers
    // granted at the org or team scope (which the settings list surfaces by
    // inheritance), not only PROJECT-scoped rows. Mirrors the delete path
    // (findByIdForOrganization); a PROJECT-only lookup is why editing an
    // org-scoped provider used to 404. The per-scope manage authz on the
    // submitted scope set still gates the write. Falls back to the
    // project-scope lookup when the tenant can't be resolved, so a missing
    // project can't widen the blast radius.
    const anchor = await this.resolveOrganizationAnchor({
      projectId,
      organizationId,
    });
    if (anchor) {
      return await this.repository.findByIdForOrganization(id, anchor);
    }
    return projectId ? await this.repository.findById(id, projectId) : null;
  }

  /**
   * The organization a write is anchored to. A caller-supplied
   * `organizationId` is only ever an anchor, never a grant: the router's
   * organization-membership middleware has already established the caller
   * belongs to it, and every lookup bounded by it stays inside that one
   * tenant. A project resolves to its own organization and wins, since it
   * is the narrower handle.
   */
  private async resolveOrganizationAnchor({
    projectId,
    organizationId,
  }: {
    projectId?: string;
    organizationId?: string;
  }): Promise<string | null> {
    if (projectId) {
      const fromProject = await this.resolveProjectOrganizationId(projectId);
      if (fromProject) return fromProject;
    }
    return organizationId ?? null;
  }

  private async updateExisting(
    existingProvider: {
      id: string;
      customKeys: unknown;
      extraHeaders: unknown;
    },
    data: {
      provider: string;
      enabled: boolean;
      name?: string;
      scopes?: ScopeInput[];
      customModels: CustomModelsInput;
      customEmbeddingsModels: CustomModelsInput;
      extraHeaders: { key: string; value: string }[];
      advanced: AdvancedGatewayInput;
    },
    validatedKeys: Record<string, unknown> | null,
    customKeysProvided: boolean,
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ) {
    let customKeysToSave: Record<string, unknown> | undefined;

    if (customKeysProvided) {
      const existingKeys = existingProvider.customKeys as Record<
        string,
        unknown
      > | null;
      this.assertKeepsStoredCredentials({
        provider: data.provider,
        validatedKeys,
        existingKeys,
      });
      customKeysToSave = mergeStoredCustomKeys({
        incoming: validatedKeys,
        stored: existingKeys,
      });
    }

    return await this.repository.update(
      existingProvider.id,
      {
        enabled: data.enabled,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        extraHeaders: this.mergeExtraHeaders(
          data.extraHeaders,
          existingProvider.extraHeaders as
            | { key: string; value: string }[]
            | null,
        ),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.scopes !== undefined && { scopes: data.scopes }),
        ...(customKeysToSave !== undefined && {
          customKeys: customKeysToSave,
        }),
        ...pickAdvancedFields(data.advanced),
      },
      tx,
    );
  }

  private async createNew(
    data: {
      name: string;
      provider: string;
      enabled: boolean;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders: { key: string; value: string }[];
      scopes: ScopeInput[];
      advanced: AdvancedGatewayInput;
    },
    validatedKeys: Record<string, unknown> | null,
    customKeysProvided: boolean,
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ) {
    return await this.repository.create(
      {
        name: data.name,
        provider: data.provider,
        enabled: data.enabled,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        // No existing row to restore from — placeholder values are dropped
        // instead of being stored literally.
        extraHeaders: this.mergeExtraHeaders(data.extraHeaders, null),
        scopes: data.scopes,
        ...(customKeysProvided &&
          validatedKeys && { customKeys: validatedKeys }),
        ...pickAdvancedFields(data.advanced),
      },
      tx,
    );
  }

  /**
   * Refuses a write whose credential payload names none of the provider's
   * credential fields.
   *
   * Such a payload cannot be a credential edit — it would replace the whole
   * bag with something that is not a credential — and it is how a UI slip
   * arrived here: a header-only object, which Azure's loose schema
   * (`.passthrough()`, every field optional) accepted without a murmur.
   * `mergeStoredCustomKeys` keeps the secrets it leaves out, so what is left
   * to lose is the visible configuration, and losing that silently is still
   * not something to do on a write that asked for nothing.
   *
   * Omission is the signal this reads, not emptiness: clearing a credential on
   * purpose sends the field with an empty value, and that still goes through.
   * `MANAGED` rows carry their own single key rather than the schema's, so they
   * are recognised too.
   */
  private assertKeepsStoredCredentials({
    provider,
    validatedKeys,
    existingKeys,
  }: {
    provider: string;
    validatedKeys: Record<string, unknown> | null;
    existingKeys: Record<string, unknown> | null;
  }): void {
    if (!existingKeys) return;

    const definition =
      modelProviders[provider as keyof typeof modelProviders] ?? undefined;
    const schemaKeys = new Set([
      ...Object.keys(getSchemaShape(definition?.keysSchema)),
      "MANAGED",
    ]);
    if (schemaKeys.size === 1) return; // unknown provider: nothing to judge against

    // Only a credential that actually holds something is worth protecting. A
    // field already sitting empty has nothing to lose, and counting it would
    // block the save right after a customer cleared one on purpose.
    const storedCredentials = Object.entries(existingKeys).filter(
      ([key, value]) =>
        schemaKeys.has(key) && typeof value === "string" && value !== "",
    );
    if (storedCredentials.length === 0) return;

    const incomingCredentials = Object.keys(validatedKeys ?? {}).filter((key) =>
      schemaKeys.has(key),
    );
    if (incomingCredentials.length > 0) return;

    throw new ModelProviderCredentialsWouldBeDroppedError({ provider });
  }

  /**
   * Header counterpart of `mergeStoredCustomKeys`: the frontend receives header
   * values as the masked placeholder, so an untouched header comes back
   * masked on save and must be restored from the stored row. Restore by
   * header key first; when the key was renamed in place, fall back to the
   * header at the same position — but only when that positional header
   * isn't also claimed by name elsewhere in the submission, so a
   * rename+reorder can never copy one header's secret under another
   * header's name. A placeholder that matches nothing is dropped rather
   * than stored as a literal value.
   */
  private mergeExtraHeaders(
    incoming: { key: string; value: string }[],
    existing: { key: string; value: string }[] | null,
  ): { key: string; value: string }[] {
    const incomingKeys = new Set(incoming.map((h) => h.key));
    return incoming.flatMap((header, index) => {
      if (header.value !== MASKED_KEY_PLACEHOLDER) return [header];
      const byKey = existing?.find((h) => h.key === header.key);
      if (byKey) return [{ key: header.key, value: byKey.value }];
      const positional = existing?.[index];
      if (positional && !incomingKeys.has(positional.key)) {
        return [{ key: header.key, value: positional.value }];
      }
      return [];
    });
  }
}
