import type { PrismaClient, Project } from "@prisma/client";
import type { Session } from "~/server/auth";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env.mjs";
import { KEY_CHECK, MASKED_KEY_PLACEHOLDER } from "../../utils/constants";
import type { CustomModelsInput } from "./customModel.schema";
import { toLegacyCompatibleCustomModels } from "./customModel.schema";
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
  getProviderModelOptions,
  type MaybeStoredModelProvider,
  modelProviders,
} from "./registry";
import { seedOnboardingDefaultsForProvider } from "./seedOnboardingDefaults";
import { isManagedProvider } from "../../../ee/managed-providers/managedBedrockConfig";

/**
 * Minimal ctx slice this service uses to authorize scope-level writes.
 * Kept narrow so the service can be constructed from any caller (tRPC,
 * Hono routes, workers) without dragging the full tRPC Context in.
 */
export type AuthzContext = { prisma: PrismaClient; session: Session | null };

/**
 * Input types for service operations
 */
export type UpdateModelProviderInput = {
  id?: string;
  projectId: string;
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
   * compatibility; when omitted on update, the existing scope set is
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

export type DeleteModelProviderInput = {
  id?: string;
  projectId: string;
  provider: string;
};

type AdvancedGatewayInput = {
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  rateLimitRpd?: number | null;
  fallbackPriorityGlobal?: number | null;
  providerConfig?: Record<string, unknown> | null;
};

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
   * - Only masks fields matching KEY_CHECK patterns (API keys)
   * - URLs and other values remain visible
   */
  async getProjectModelProvidersForFrontend(
    projectId: string,
    includeKeys = true,
  ): Promise<Record<string, MaybeStoredModelProvider>> {
    const providers = await this.getProjectModelProviders(
      projectId,
      includeKeys,
    );

    if (!includeKeys) {
      return providers;
    }

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
    const savedProviders = await this.repository.findAllAccessibleForProject(
      projectId,
    );
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
      });
    }

    const storedRows = savedProviders
      .filter((mp) => this.shouldKeepModelProvider(mp, defaultProviders))
      .map((mp) => {
        const defaultProvider = defaultProviders[mp.provider];
        const customModels = toLegacyCompatibleCustomModels(
          mp.customModels,
          "chat",
        );
        const customEmbeddingsModels = toLegacyCompatibleCustomModels(
          mp.customEmbeddingsModels,
          "embedding",
        );
        const narrowestScope = this.pickNarrowestScope(mp.scopes);
        const masked = (mp.customKeys
          ? Object.fromEntries(
              Object.entries(
                mp.customKeys as Record<string, unknown>,
              ).map(([key, value]) => [
                key,
                KEY_CHECK.some((k) => key.includes(k))
                  ? MASKED_KEY_PLACEHOLDER
                  : value,
              ]),
            )
          : null) as MaybeStoredModelProvider["customKeys"];
        const provider_: MaybeStoredModelProvider = {
          id: mp.id,
          name: mp.name,
          provider: mp.provider,
          enabled: mp.enabled,
          customKeys: masked,
          models: defaultProvider?.models ?? null,
          embeddingsModels: defaultProvider?.embeddingsModels ?? null,
          customModels: customModels.length > 0 ? customModels : null,
          customEmbeddingsModels:
            customEmbeddingsModels.length > 0 ? customEmbeddingsModels : null,
          deploymentMapping: mp.deploymentMapping,
          disabledByDefault: defaultProvider?.disabledByDefault,
          extraHeaders: mp.extraHeaders as
            | { key: string; value: string }[]
            | null,
          scopes: mp.scopes.map((s) => ({
            scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
            scopeId: s.scopeId,
          })),
          scopeType: narrowestScope.scopeType,
          scopeId: narrowestScope.scopeId,
        };
        return provider_;
      });
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
  async listOrgModelProvidersForFrontend(
    organizationId: string,
  ): Promise<MaybeStoredModelProvider[]> {
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

    const systemRows: MaybeStoredModelProvider[] = [];
    for (const [providerKey, provider_] of Object.entries(defaultProviders)) {
      if (savedProviderKeys.has(providerKey)) continue;
      if (!provider_.enabled) continue;
      systemRows.push({ ...provider_, isSystem: true, scopes: [] });
    }
    // Managed bedrock: env var MANAGED_BEDROCK__<label>__<orgId> sets
    // up cross-account credentials for a specific org. Surface a SYSTEM
    // pseudo-row so the table shows the user where it's coming from.
    // Skip when bedrock is already represented (saved row OR a standard
    // env-fed pseudo-row pushed in the loop above).
    const bedrockAlreadyShown =
      savedProviderKeys.has("bedrock") ||
      systemRows.some((r) => r.provider === "bedrock");
    if (
      !bedrockAlreadyShown &&
      isManagedProvider(organizationId, "bedrock")
    ) {
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
      .map((mp) => {
        const defaultProvider = defaultProviders[mp.provider];
        const customModels = toLegacyCompatibleCustomModels(
          mp.customModels,
          "chat",
        );
        const customEmbeddingsModels = toLegacyCompatibleCustomModels(
          mp.customEmbeddingsModels,
          "embedding",
        );
        const narrowestScope = this.pickNarrowestScope(mp.scopes);
        const masked = (mp.customKeys
          ? Object.fromEntries(
              Object.entries(
                mp.customKeys as Record<string, unknown>,
              ).map(([key, value]) => [
                key,
                KEY_CHECK.some((k) => key.includes(k))
                  ? MASKED_KEY_PLACEHOLDER
                  : value,
              ]),
            )
          : null) as MaybeStoredModelProvider["customKeys"];
        const provider_: MaybeStoredModelProvider = {
          id: mp.id,
          name: mp.name,
          provider: mp.provider,
          enabled: mp.enabled,
          customKeys: masked,
          models: defaultProvider?.models ?? null,
          embeddingsModels: defaultProvider?.embeddingsModels ?? null,
          customModels: customModels.length > 0 ? customModels : null,
          customEmbeddingsModels:
            customEmbeddingsModels.length > 0 ? customEmbeddingsModels : null,
          deploymentMapping: mp.deploymentMapping,
          disabledByDefault: defaultProvider?.disabledByDefault,
          extraHeaders: mp.extraHeaders as
            | { key: string; value: string }[]
            | null,
          scopes: mp.scopes.map((s) => ({
            scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
            scopeId: s.scopeId,
          })),
          scopeType: narrowestScope.scopeType,
          scopeId: narrowestScope.scopeId,
        };
        return provider_;
      });
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
    const registry =
      modelProviders[providerKey as keyof typeof modelProviders];
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

    const advanced = {
      rateLimitRpm,
      rateLimitTpm,
      rateLimitRpd,
      fallbackPriorityGlobal,
      providerConfig,
    };
    const hasAdvancedWrite =
      rateLimitRpm !== undefined ||
      rateLimitTpm !== undefined ||
      rateLimitRpd !== undefined ||
      fallbackPriorityGlobal !== undefined ||
      providerConfig !== undefined;

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
    const existingProvider = await this.findExistingProvider(id, projectId);

    // Resolve input scope set. Callers may pass `scopes: [...]` directly,
    // or a single-scope pair via the legacy `scopeType`/`scopeId` fields.
    // When neither is given, defer to the create/update defaults.
    const scopes: ScopeInput[] | undefined =
      input.scopes ??
      (input.scopeType && input.scopeId
        ? [{ scopeType: input.scopeType, scopeId: input.scopeId }]
        : undefined);

    // Fail-closed scope authz. Every (scopeType, scopeId) entry in the
    // target set must pass the caller's manage-permission check; a
    // single failure aborts the whole operation so partial-success
    // cannot silently rebind a credential the caller can't see.
    if (ctx && scopes) {
      await assertCanManageAllScopes(ctx, scopes);
    }

    // Advanced (Gateway) writes also require manage on every scope the
    // existing row is bound to — not just the project the caller is in.
    // Matches the previous `updateAdvancedSettings` contract: a project
    // admin must not nudge rate limits on a credential that's also
    // bound to its parent org/team without manage there. The basic
    // update path keeps its existing semantics (project:update gate
    // only) so this PR doesn't tighten unrelated writes.
    if (ctx && hasAdvancedWrite && existingProvider) {
      await assertCanManageAllScopes(
        ctx,
        existingProvider.scopes.map((s) => ({
          scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
          scopeId: s.scopeId,
        })),
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      let result;

      if (existingProvider) {
        result = await this.updateExisting(
          existingProvider,
          {
            projectId,
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
            projectId,
            provider,
            enabled,
            name: name ?? this.deriveDefaultName(provider),
            scopes,
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
        const targetScopes: ScopeInput[] = scopes ?? [
          { scopeType: "PROJECT", scopeId: projectId },
        ];
        for (const scope of targetScopes) {
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
    input: UpdateModelProviderInput,
    ctx?: AuthzContext,
  ) {
    const existing = await this.repository.findByProvider(
      input.provider,
      input.projectId,
    );
    return await this.updateModelProvider(
      { ...input, id: existing?.id },
      ctx,
    );
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
      provider
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    );
  }

  /**
   * Deletes a model provider.
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

    if (ctx) {
      const existing = id
        ? await this.repository.findById(id, projectId)
        : await this.repository.findByProvider(provider, projectId);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Model provider not found for this project",
        });
      }
      await assertCanManageAllScopes(
        ctx,
        existing.scopes.map((s) => ({
          scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
          scopeId: s.scopeId,
        })),
      );
    }

    if (id) {
      return await this.repository.delete(id, projectId);
    } else {
      return await this.repository.deleteByProvider(provider, projectId);
    }
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
    const existing = await this.repository.findById(id, projectId);
    if (!existing) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Model provider not found",
      });
    }
    const readable = await canReadAnyScope(
      ctx,
      existing.scopes.map((s) => ({
        scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        scopeId: s.scopeId,
      })),
    );
    if (!readable) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Model provider not found",
      });
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
    // (e.g. an ORG row and a PROJECT override), narrower-scope wins for
    // the legacy `Record<provider, …>` shape we still return here —
    // new consumers that need the full list should call
    // `listAccessibleForProject` directly on the service.
    const savedProviders =
      await this.repository.findAllAccessibleForProject(projectId);

    return savedProviders
      .filter((mp) => this.shouldKeepModelProvider(mp, defaultProviders))
      .reduce(
        (acc, mp) => {
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

          const provider_: MaybeStoredModelProvider = {
            id: mp.id,
            name: mp.name,
            provider: mp.provider,
            enabled: mp.enabled,
            customKeys: includeKeys ? mp.customKeys : null,
            models: defaultProvider?.models ?? null,
            embeddingsModels: defaultProvider?.embeddingsModels ?? null,
            customModels:
              customModels.length > 0 ? customModels : null,
            customEmbeddingsModels:
              customEmbeddingsModels.length > 0
                ? customEmbeddingsModels
                : null,
            deploymentMapping: mp.deploymentMapping,
            disabledByDefault: defaultProvider?.disabledByDefault,
            extraHeaders: mp.extraHeaders as
              | { key: string; value: string }[]
              | null,
            scopes: mp.scopes.map((s) => ({
              scopeType: s.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
              scopeId: s.scopeId,
            })),
            scopeType: narrowestScope.scopeType,
            scopeId: narrowestScope.scopeId,
          };

          // Narrower-scope wins when the same provider string has
          // multiple accessible rows (preserves iter 107/108 semantics
          // for the Record<provider, …> consumers).
          const existing = acc[mp.provider];
          if (!existing || this.isNarrower(provider_, existing)) {
            return { ...acc, [mp.provider]: provider_ };
          }
          return acc;
        },
        {} as Record<string, MaybeStoredModelProvider>,
      );
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
        this.scopePriority(
          b.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        ) -
        this.scopePriority(
          a.scopeType as "ORGANIZATION" | "TEAM" | "PROJECT",
        ),
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
      if (config.customKeys) {
        masked[providerKey] = {
          ...config,
          customKeys: Object.fromEntries(
            Object.entries(config.customKeys).map(([key, value]) => [
              key,
              KEY_CHECK.some((k) => key.includes(k))
                ? MASKED_KEY_PLACEHOLDER
                : value,
            ]),
          ),
        };
      }
    }

    return masked;
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
  private async findExistingProvider(
    id: string | undefined,
    projectId: string,
  ) {
    if (!id) return null;
    return await this.repository.findById(id, projectId);
  }

  private async updateExisting(
    existingProvider: { id: string; customKeys: unknown },
    data: {
      projectId: string;
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
      customKeysToSave = this.mergeCustomKeys(
        validatedKeys,
        existingProvider.customKeys as Record<string, unknown> | null,
      );
    }

    return await this.repository.update(
      existingProvider.id,
      data.projectId,
      {
        enabled: data.enabled,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        extraHeaders: data.extraHeaders,
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
      projectId: string;
      name: string;
      provider: string;
      enabled: boolean;
      customModels?: CustomModelsInput;
      customEmbeddingsModels?: CustomModelsInput;
      extraHeaders: { key: string; value: string }[];
      scopes?: ScopeInput[];
      advanced: AdvancedGatewayInput;
    },
    validatedKeys: Record<string, unknown> | null,
    customKeysProvided: boolean,
    tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  ) {
    return await this.repository.create(
      {
        projectId: data.projectId,
        name: data.name,
        provider: data.provider,
        enabled: data.enabled,
        customModels: data.customModels,
        customEmbeddingsModels: data.customEmbeddingsModels,
        extraHeaders: data.extraHeaders,
        scopes: data.scopes,
        ...(customKeysProvided &&
          validatedKeys && { customKeys: validatedKeys }),
        ...pickAdvancedFields(data.advanced),
      },
      tx,
    );
  }

  /**
   * Smart merging: preserves original keys when masked placeholder is sent.
   *
   * Business rules:
   * - Start with new validated keys
   * - For any key with MASKED_KEY_PLACEHOLDER value, use existing value
   */
  private mergeCustomKeys(
    validatedKeys: Record<string, unknown> | null,
    existingKeys: Record<string, unknown> | null,
  ): Record<string, unknown> {
    if (!validatedKeys) return {};

    if (!existingKeys) return validatedKeys;

    return {
      ...validatedKeys,
      ...Object.fromEntries(
        Object.entries(existingKeys)
          .filter(([key]) => validatedKeys[key] === MASKED_KEY_PLACEHOLDER)
          .map(([key, value]) => [key, value]),
      ),
    };
  }
}
