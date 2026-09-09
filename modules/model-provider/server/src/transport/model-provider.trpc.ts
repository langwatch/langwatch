/**
 * The server half of `modelProvider.*`. A provider write reaches the tenant
 * its BODY names, and which permission that needs depends on which handle
 * arrived, so those declare `serviceAuthorized`: the application's per-scope
 * `assertCanWrite` is the check, and the declaration says what it enforces.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  ModelProviderApi,
  modelProviderTrpc,
  type ModelProviderListEntry,
} from "@langwatch/model-provider-contract";

import { toCanonicalCustomModelList } from "../rules/custom-model-list.rules.ts";

/** Which permissions the application enforces on a provider write, scope by scope. */
const PROVIDER_WRITE_PERMISSIONS = [
  "project:update",
  "team:manage",
  "organization:manage",
] as const;

/** Which permissions the application enforces on a default-models write. */
const DEFAULT_WRITE_PERMISSIONS = [
  "organization:manage",
  "team:manage",
  "project:manage",
] as const;

const TENANT_IS_DATA =
  "the tenant anchor is data: a project when one is named, otherwise the organization the provider belongs to, and the application's per-scope assertCanWrite is what checks it";

const PROBE_IS_THE_GATE =
  "the credential probe leaves this process for the vendor with caller-supplied keys, so the application checks the caller may write the tenant they named BEFORE probing; that check is the whole authorization";

const DEFAULT_SCOPE_IS_DATA =
  "the tier is data: the scope the caller names decides the permission, and the application's assertCanWriteDefault is what checks it";

const STORED_SCOPES_DECIDE =
  "the scopes are the stored row's, not the caller's input, so only the application can know which permissions to require";

/** The fields a service-authorized provider write claims to have covered. */
const TENANT_FIELDS = {
  projectId: TENANT_IS_DATA,
  organizationId: TENANT_IS_DATA,
} as const;

export const modelProviderTrpcTransport = defineTrpcRouter(ModelProviderApi, modelProviderTrpc)
  // tRPC answers land in the browser, so every read here goes through the
  // masking operation; decrypted credentials are only for server-internal
  // callers of `getExecutionProviders`.
  .procedure("getAllForProject")
  .withPermission("project:view")
  .handle(async ({ app, input }) =>
    toListEntryMap(await app.getForProject({ projectId: input.projectId })),
  )

  .procedure("getAllForProjectForFrontend")
  .withPermission("project:view")
  .handle(async ({ app, input }) =>
    toListEntryMap(await app.getForProject({ projectId: input.projectId })),
  )

  .procedure("listAllForProjectForFrontend")
  .withPermission("project:view")
  .handle(async ({ app, input }) =>
    (await app.listForProject({ projectId: input.projectId })).map(toListEntry),
  )

  .procedure("listAllForOrganizationForFrontend")
  .withPermission("organization:view")
  .handle(async ({ app, input }) =>
    (await app.listForOrganization({ organizationId: input.organizationId })).map(toListEntry),
  )

  .procedure("update")
  .serviceAuthorized({
    reason: TENANT_IS_DATA,
    permissions: PROVIDER_WRITE_PERMISSIONS,
    enforces: TENANT_FIELDS,
  })
  .handle(async ({ app, input, actor }) => {
    const saved = await app.upsert(
      {
        id: input.id,
        projectId: input.projectId,
        organizationId: input.organizationId,
        provider: input.provider,
        name: input.name,
        enabled: input.enabled,
        customKeys: input.customKeys as Record<string, unknown> | null | undefined,
        customModels: toCanonicalCustomModelList(input.customModels, "chat"),
        customEmbeddingsModels: toCanonicalCustomModelList(
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
        providerConfig: input.providerConfig as Record<string, unknown> | null | undefined,
        langySkipPermissionsModels: input.langySkipPermissionsModels,
      },
      actor,
    );

    return toListEntry(saved);
  })

  .procedure("delete")
  .serviceAuthorized({
    reason: TENANT_IS_DATA,
    permissions: PROVIDER_WRITE_PERMISSIONS,
    enforces: TENANT_FIELDS,
  })
  .handle(async ({ app, input, actor }) => {
    await app.delete(input, actor);
  })

  .procedure("validateApiKey")
  .serviceAuthorized({
    reason: PROBE_IS_THE_GATE,
    permissions: ["project:update", "organization:manage"],
    enforces: { projectId: PROBE_IS_THE_GATE, organizationId: PROBE_IS_THE_GATE },
  })
  .handle(({ app, input, actor }) =>
    app.validateApiKey(
      {
        projectId: input.projectId,
        organizationId: input.organizationId,
        provider: input.provider,
        customKeys: input.customKeys,
      },
      actor,
    ),
  )

  .procedure("testConnection")
  .serviceAuthorized({
    reason: TENANT_IS_DATA,
    permissions: PROVIDER_WRITE_PERMISSIONS,
    enforces: TENANT_FIELDS,
  })
  .handle(({ app, input, actor }) => app.testConnection(input, actor))

  .procedure("codexSignInStart")
  .withPermission("project:update")
  .handle(({ app }) => app.startCodexDeviceSignIn())

  .procedure("codexSignInPoll")
  .withPermission("project:update")
  .handle(async ({ app, input, actor }) => {
    const poll = await app.pollCodexDeviceSignIn({
      deviceAuthId: input.deviceAuthId,
      userCode: input.userCode,
    });

    if (poll.status === "pending") return { status: "pending" as const };

    const saved = await app.upsert(
      {
        projectId: input.projectId,
        provider: "openai_codex",
        enabled: true,
        customKeys: poll.keys,
        scopes: input.scopes,
      },
      actor,
    );

    if (input.setAsCodingDefaults) {
      await app.applyCodexCodingDefaults({ scopes: input.scopes }, actor);
    }

    return {
      status: "complete" as const,
      providerId: saved.id,
      email: poll.keys.CODEX_EMAIL,
      plan: poll.keys.CODEX_PLAN,
    };
  })

  .procedure("codexApplyCodingDefaults")
  .withPermission("project:update")
  .handle(async ({ app, input, actor }) => {
    await app.applyCodexCodingDefaults({ scopes: input.scopes }, actor);

    return { applied: true as const };
  })

  .procedure("codexStatus")
  .withPermission("project:view")
  .handle(({ app, input }) => app.getCodexStatus(input))

  .procedure("isManagedProvider")
  .withPermission("organization:view")
  .handle(({ app, input }) => ({ managed: app.isManagedProvider(input) }))

  .procedure("validateKeyWithCustomUrl")
  .withPermission("project:update")
  .handle(({ app, input }) =>
    app.validateStoredKey({
      projectId: input.projectId,
      provider: input.provider,
      customBaseUrl: input.customBaseUrl,
    }),
  )

  .procedure("getResolvedDefault")
  .withPermission("project:view")
  .handle(({ app, input }) =>
    app.tryGetResolvedDefault({ projectId: input.projectId, featureKey: input.featureKey }),
  )

  .procedure("getDefaultModelsForProject")
  .withPermission("project:view")
  .handle(({ app, input, actor }) =>
    app.getDefaultSnapshot({ projectId: input.projectId }, actor),
  )

  .procedure("setRoleAssignmentForScope")
  .serviceAuthorized({ reason: DEFAULT_SCOPE_IS_DATA, permissions: DEFAULT_WRITE_PERMISSIONS })
  .handle(async ({ app, input, actor }) => {
    await app.setDefault(
      {
        scope: { scopeType: input.scopeType, scopeId: input.scopeId },
        key: input.role,
        model: input.model,
      },
      actor,
    );

    return { ok: true as const };
  })

  .procedure("setFeatureOverrideForScope")
  .serviceAuthorized({ reason: DEFAULT_SCOPE_IS_DATA, permissions: DEFAULT_WRITE_PERMISSIONS })
  .handle(async ({ app, input, actor }) => {
    await app.setDefault(
      {
        scope: { scopeType: input.scopeType, scopeId: input.scopeId },
        key: input.featureKey,
        model: input.model,
      },
      actor,
    );

    return { ok: true as const };
  })

  .procedure("saveDefaultModelsConfig")
  .serviceAuthorized({ reason: DEFAULT_SCOPE_IS_DATA, permissions: DEFAULT_WRITE_PERMISSIONS })
  .handle(async ({ app, input, actor }) => {
    const saved = await app.saveDefaultConfig(input, actor);

    return { id: saved.id };
  })

  .procedure("deleteDefaultModelsConfig")
  .serviceAuthorized({ reason: STORED_SCOPES_DECIDE, permissions: DEFAULT_WRITE_PERMISSIONS })
  .handle(async ({ app, input, actor }) => {
    await app.deleteDefaultConfig({ id: input.id }, actor);

    return { ok: true as const };
  })

  .procedure("getInheritedValuesForScopes")
  .withPermission("project:view")
  .handle(({ app, input }) =>
    app.getInheritedValues({
      projectId: input.projectId,
      scopes: input.scopes,
      excludeConfigId: input.excludeConfigId,
    }),
  )
  .build();

/**
 * The stored provider reduced to what this transport reads. Named rather than
 * imported whole so a field added to the application's own shape cannot
 * silently start leaving through the wire mapper below.
 */
type CanonicalProvider = {
  id: string;
  provider: string;
  /** Per-row display name, so multi-instance rows do not collapse to one vendor label. */
  name: string;
  enabled: boolean;
  /** Set when withdrawn; `isRoutable` fails closed on it, so pickers must see it. */
  disabledAt?: ModelProviderListEntry["disabledAt"];
  /** Last known reachability, rendered by the routing-policy credential picker. */
  healthStatus?: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CIRCUIT_OPEN";
  customKeys: Record<string, unknown> | null;
  customModels: Array<{ id: string; label: string; type: string }>;
  customEmbeddingsModels: Array<{ id: string; label: string; type: string }>;
  models?: string[] | null;
  embeddingsModels?: string[] | null;
  /** Where the provider is attached; `filterProvidersByScope` reads it directly. */
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
  /** Operator override, or null to fall through to the registry default (ADR-129). */
  langySkipPermissionsModels?: string[] | null;
  /** Gateway knobs the Advanced (Gateway) accordion edits. */
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  rateLimitRpd?: number | null;
  fallbackPriorityGlobal?: number | null;
  providerConfig?: Record<string, unknown> | null;
};

/**
 * The list projection the browser renders, as one function every provider
 * read goes through.
 */
function toListEntry(provider: CanonicalProvider): ModelProviderListEntry {
  return {
    id: provider.id,
    provider: provider.provider,
    name: provider.name,
    enabled: provider.enabled,
    disabledAt: provider.disabledAt ?? null,
    healthStatus: provider.healthStatus ?? null,
    customKeys: provider.customKeys,
    deploymentMapping: null,
    scopes: provider.scopes,
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
    langySkipPermissionsModels: provider.langySkipPermissionsModels ?? null,
    rateLimitRpm: provider.rateLimitRpm ?? null,
    rateLimitTpm: provider.rateLimitTpm ?? null,
    rateLimitRpd: provider.rateLimitRpd ?? null,
    fallbackPriorityGlobal: provider.fallbackPriorityGlobal ?? null,
    providerConfig: provider.providerConfig ?? null,
  };
}

/** `as const` keeps the tuple typed so `Object.fromEntries` does not erase to `any`. */
function toListEntryMap(
  providers: Record<string, CanonicalProvider>,
): Record<string, ModelProviderListEntry> {
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [key, toListEntry(provider)] as const),
  );
}
