/**
 * The Model Provider surface over the process's tRPC transport.
 *
 * Three families share one router:
 *
 *   read paths      getAllForProject, getAllForProjectForFrontend,
 *                   listAllForProjectForFrontend,
 *                   listAllForOrganizationForFrontend, codexStatus,
 *                   isManagedProvider.
 *   write paths     update, delete, validateApiKey, testConnection, and the
 *                   Codex device sign-in pair.
 *   default models  the role/feature-keyed defaults and the cascade reads
 *                   behind the Default Models settings page.
 *
 * Credentials: every tRPC response lands in a browser, so each read goes
 * through the service method that masks stored keys — the decrypted
 * `customKeys` are only ever handed to server-internal callers of
 * `getExecutionProviders`. Nothing here ever writes a credential value into
 * an audit record: the process's `auditLogMutations` redacts `customKeys`,
 * `providerConfig` and `extraHeaders` by field name, and the one audit entry
 * written by hand below (`codexSignInPoll`) carries the plan tier and the
 * scopes, never the token set or the account email.
 *
 * Transport only: input parsing, the authorization declarations, and
 * delegation to {@link ModelProviderApp}. No handler stamps the caller onto a
 * write any more — the application does, once, for every write. The provider
 * probes, the Codex device flow and the audit trail arrive as ports because
 * they are process capabilities rather than the feature's own persistence.
 *
 * Specs: specs/model-providers/codex-account-provider.feature,
 * specs/model-providers/role-based-default-models.feature,
 * specs/model-providers/model-default-config-cascade.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { CustomModelList } from "../../adapters/custom-model-list.adapter";
import {
  modelDefaultConfigDeleteTrpcInputSchema,
  modelDefaultConfigSaveTrpcInputSchema,
  modelDefaultFeatureOverrideTrpcInputSchema,
  modelDefaultInheritedValuesTrpcInputSchema,
  modelDefaultResolvedTrpcInputSchema,
  modelDefaultRoleAssignmentTrpcInputSchema,
  modelProviderCodexApplyCodingDefaultsTrpcInputSchema,
  modelProviderCodexSignInPollTrpcInputSchema,
  modelProviderDeleteTrpcInputSchema,
  modelProviderIsManagedTrpcInputSchema,
  modelProviderOrganizationTrpcInputSchema,
  modelProviderProjectTrpcInputSchema,
  modelProviderTestConnectionTrpcInputSchema,
  modelProviderUpdateTrpcInputSchema,
  modelProviderValidateApiKeyTrpcInputSchema,
  modelProviderValidateKeyWithCustomUrlTrpcInputSchema,
  type CodexTokenKeys,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import type { ModelProviderApp } from "#app/model-provider.app";

/**
 * The process supplies authentication and the permission decision engine;
 * authorization declarations arrive as the `policy` bag below.
 *
 * `app` is the slice of the process's application this feature reaches, not
 * the feature's application itself, because a tRPC root is shared by every
 * feature mounted on it and so carries all of them.
 */
export type ModelProviderTrpcContext = Readonly<{
  app: Readonly<{ modelProviders: ModelProviderApp }>;
  actor(): Readonly<{ id: string }>;
}>;

/**
 * A process middleware chain applied to one already-parsed procedure.
 *
 * Every member of the policy bag returns one of these rather than a composed
 * builder, because tRPC appends the input parser at the point `.input()` is
 * called: a check installed before it reads `input === undefined`, and every
 * declaration below reads its scope id out of the validated input.
 */
type ProcedureDecorator = <TProcedure>(procedure: TProcedure) => TProcedure;

type ModelProviderTrpcProcedures<
  TContext extends ModelProviderTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   */
  policy(permission: AuthzPermission): ProcedureDecorator;
  /**
   * The tenant gate for a provider write that may arrive with either handle:
   * the project permission when a project is named, organization membership
   * otherwise. What the caller may actually write is then decided per scope
   * inside the service.
   */
  tenantWritePolicy(permission: "project:update" | "project:delete"): ProcedureDecorator;
  /**
   * The gate for the credential probe. Nothing downstream re-authorizes it —
   * the handler goes straight out to the provider with caller-supplied keys —
   * so this IS the authorization rather than a coarse pre-filter.
   */
  credentialProbePolicy: ProcedureDecorator;
  /**
   * The declaration for a procedure whose scope is data the service loads at
   * runtime, so the service performs the real check. Records why, and which
   * permissions the service enforces.
   */
  serviceAuthorizedPolicy(options: {
    reason: string;
    permissions: readonly AuthzPermission[];
  }): ProcedureDecorator;
}>;

/**
 * The process capabilities this transport needs that are not the Model
 * Provider service's own: the outbound credential probes, the Codex device
 * flow, and the audit trail.
 *
 * The two credential-probe verdicts are type PARAMETERS rather than
 * `unknown`, because a generic constraint does not carry a concrete shape out
 * to the caller. `create` used to declare `TPorts extends
 * ModelProviderTrpcPorts` and take `ports: TPorts`: a generic body is checked
 * once against its constraint, so `ports.validateProviderApiKey(...)` was
 * `Promise<unknown>` at the declaration site and the router's output type
 * baked in `unknown` whatever the process wired in — which is what left
 * `useModelProviderApiKeyValidation` reading `result.valid` off `unknown`.
 * Naming them here and passing `ports:
 * ModelProviderTrpcPorts<TApiKeyValidation, TStoredKeyValidation>` instead
 * lets inference fill them from the object the process actually passes, and
 * the verdict union reaches the browser.
 */
type ModelProviderTrpcPorts<TApiKeyValidation = unknown, TStoredKeyValidation = unknown> = Readonly<{
  /** Probes a caller-supplied credential against the provider. */
  validateProviderApiKey(
    provider: string,
    customKeys: Record<string, string>,
  ): Promise<TApiKeyValidation>;
  /** Probes a stored (or environment-fed) credential against a base URL. */
  validateKeyWithCustomUrl(input: {
    projectId: string;
    provider: string;
    customBaseUrl: string | undefined;
    modelProviders: ModelProviderService;
  }): Promise<TStoredKeyValidation>;
  /** Codex sign-in step 1: ask the issuer for a device code. */
  startCodexDeviceSignIn(): Promise<{
    userCode: string;
    deviceAuthId: string;
    verificationUrl: string;
    /** Seconds the caller should wait between polls. */
    intervalSeconds: number;
  }>;
  /**
   * Codex sign-in step 2..n: one poll of the pending device authorization.
   *
   * A completed exchange carries the full `CodexTokenKeys` set, so the account
   * email and plan tier the response hands back are known strings rather than
   * maybes.
   */
  pollCodexDeviceSignIn(input: {
    deviceAuthId: string;
    userCode: string;
  }): Promise<{ status: "pending" } | { status: "complete"; keys: CodexTokenKeys }>;
  /** The process's audit trail. */
  recordAudit(entry: {
    userId: string;
    projectId: string;
    action: string;
    targetKind?: string;
    targetId?: string;
    args: Readonly<Record<string, unknown>>;
  }): void;
}>;

/**
 * The canonical execution DTO reduced to what this transport reads. Named
 * rather than imported whole so a field added to the service's own shape
 * cannot silently start leaving through the wire mapper below.
 */
type CanonicalProvider = {
  id: string;
  provider: string;
  /**
   * The row's own display name. Carried because a multi-instance setup names
   * its rows ("OpenAI" at organization scope, "OpenAI2" on a project) and every
   * surface that lists providers labels them with it: the settings table, the
   * routing-policy credential picker, the budget drawer's provider select. With
   * it narrowed away those all fell back to the registry name, so two rows for
   * the same vendor rendered identically. Not sensitive: a name is what an
   * admin typed into the form, never a credential.
   */
  name: string;
  enabled: boolean;
  /**
   * When set, an admin has withdrawn the credential. Carried because the
   * gateway pickers fail closed on it — `isRoutable` in
   * `components/gateway/eligibleModelProviders.ts` requires
   * `enabled === true && !disabledAt` — and a row that arrives without the
   * field reads as "never withdrawn", so a disabled credential was being
   * advertised as eligible. The routing-policy picker renders it too.
   */
  disabledAt?: Date | null;
  /**
   * Last known reachability of the credential. The routing-policy credential
   * picker renders it per row (`useRoutingPolicyDrawerForm`), and defaults to
   * "UNKNOWN" when absent — which is what every row showed while this was
   * narrowed away.
   */
  healthStatus?: "UNKNOWN" | "HEALTHY" | "DEGRADED" | "CIRCUIT_OPEN";
  customKeys: Record<string, unknown> | null;
  customModels: Array<{ id: string; label: string; type: string }>;
  customEmbeddingsModels: Array<{ id: string; label: string; type: string }>;
  models?: string[] | null;
  embeddingsModels?: string[] | null;
  /**
   * Where the provider is attached. Carried because the model-providers
   * settings page filters and orders by it — narrowing it away here left
   * `filterProvidersByScope` nothing to read, so picking any scope but "all"
   * emptied the table. Not sensitive: a scope says which organization, team or
   * project a provider belongs to, never anything about its credentials.
   */
  scopes: Array<{ scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }>;
};

function toLegacyProvider(provider: CanonicalProvider) {
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
  };
}

function toLegacyProviderMap(providers: Record<string, CanonicalProvider>) {
  return Object.fromEntries(
    Object.entries(providers).map(([key, provider]) => [key, toLegacyProvider(provider)]),
  );
}

/**
 * Installs the complete `modelProvider.*` tRPC surface on a process-owned
 * root. The procedure and the policy bag are injected by the process so its
 * auth, audit, error, logging and tracing policies wrap every feature
 * procedure consistently.
 */
export class ModelProviderTrpcApi {
  static create<
    TContext extends ModelProviderTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
    TApiKeyValidation,
    TStoredKeyValidation,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ModelProviderTrpcProcedures<TContext, TOptions, TRoot>,
    ports: ModelProviderTrpcPorts<TApiKeyValidation, TStoredKeyValidation>,
  ) {
    const {
      protected: procedure,
      policy,
      tenantWritePolicy,
      credentialProbePolicy,
      serviceAuthorizedPolicy,
    } = procedures;

    return trpc.router({
      // tRPC responses land in the browser, so every query here must go
      // through the masking service method — decrypted customKeys are only
      // for server-internal callers of `getExecutionProviders`.
      getAllForProject: policy("project:view")(
        procedure.input(modelProviderProjectTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        const providers = await ctx.app.modelProviders.getForProject({
          projectId: input.projectId,
        });
        return toLegacyProviderMap(providers);
      }),

      getAllForProjectForFrontend: policy("project:view")(
        procedure.input(modelProviderProjectTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return toLegacyProviderMap(
          await ctx.app.modelProviders.getForProject({ projectId: input.projectId }),
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
      listAllForProjectForFrontend: policy("project:view")(
        procedure.input(modelProviderProjectTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return (await ctx.app.modelProviders.listForProject({ projectId: input.projectId })).map(
          toLegacyProvider,
        );
      }),

      /**
       * Org-wide variant: returns every ModelProvider attached anywhere
       * inside the organization (org + every team + every project),
       * including env-fed pseudo-rows. The model-providers settings page
       * uses this for the "All you can see" view so an admin sees the
       * providers a sibling project's owner has configured.
       */
      listAllForOrganizationForFrontend: policy("organization:view")(
        procedure.input(modelProviderOrganizationTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return (
          await ctx.app.modelProviders.listForOrganization({
            organizationId: input.organizationId,
          })
        ).map(toLegacyProvider);
      }),

      update: tenantWritePolicy("project:update")(
        procedure.input(modelProviderUpdateTrpcInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const result = await ctx.app.modelProviders.upsert(
          {
            id: input.id,
            projectId: input.projectId,
            organizationId: input.organizationId,
            provider: input.provider,
            name: input.name,
            enabled: input.enabled,
            customKeys: input.customKeys as Record<string, unknown> | null | undefined,
            customModels: CustomModelList.toCanonical(input.customModels, "chat"),
            customEmbeddingsModels: CustomModelList.toCanonical(
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
          },
          ctx.actor(),
        );

        return toLegacyProvider(result);
      }),

      delete: tenantWritePolicy("project:delete")(
        procedure.input(modelProviderDeleteTrpcInputSchema),
      ).mutation(async ({ input, ctx }) => {
        return await ctx.app.modelProviders.delete(input, ctx.actor());
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
      validateApiKey: credentialProbePolicy(
        procedure.input(modelProviderValidateApiKeyTrpcInputSchema),
      ).mutation(async ({ input }) => {
        const { provider, customKeys } = input;
        return ports.validateProviderApiKey(provider, customKeys);
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
      testConnection: tenantWritePolicy("project:update")(
        procedure.input(modelProviderTestConnectionTrpcInputSchema),
      ).mutation(async ({ input, ctx }) => {
        return await ctx.app.modelProviders.testConnection(input, ctx.actor());
      }),

      /**
       * Codex sign-in, step 1: ask OpenAI for a device code. Nothing is stored —
       * the pending sign-in's identifiers travel to the client and come back on
       * every poll, so polling works across server instances.
       * Spec: specs/model-providers/codex-account-provider.feature
       */
      codexSignInStart: policy("project:update")(
        procedure.input(modelProviderProjectTrpcInputSchema),
      ).mutation(async () => {
        return await ports.startCodexDeviceSignIn();
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
      codexSignInPoll: policy("project:update")(
        procedure.input(modelProviderCodexSignInPollTrpcInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const poll = await ports.pollCodexDeviceSignIn({
          deviceAuthId: input.deviceAuthId,
          userCode: input.userCode,
        });
        if (poll.status === "pending") {
          return { status: "pending" as const };
        }

        const actor = ctx.actor();
        const actorId = actor.id;
        const saved = await ctx.app.modelProviders.upsert(
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
          await ctx.app.modelProviders.applyCodexCodingDefaults({ scopes: input.scopes }, actor);
        }

        // The response hands the connector their own account email (PII), so
        // the connect event is audit-logged: who, where, and which scopes. The
        // email itself deliberately stays out of the log row.
        ports.recordAudit({
          userId: actorId,
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
      codexApplyCodingDefaults: policy("project:update")(
        procedure.input(modelProviderCodexApplyCodingDefaultsTrpcInputSchema),
      ).mutation(async ({ input, ctx }) => {
        const actor = ctx.actor();
        await ctx.app.modelProviders.applyCodexCodingDefaults({ scopes: input.scopes }, actor);
        ports.recordAudit({
          userId: actor.id,
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
      codexStatus: policy("project:view")(
        procedure.input(modelProviderProjectTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return ctx.app.modelProviders.getCodexStatus(input);
      }),

      isManagedProvider: policy("organization:view")(
        procedure.input(modelProviderIsManagedTrpcInputSchema),
      ).query(({ input, ctx }) => {
        return {
          managed: ctx.app.modelProviders.isManagedProvider(input),
        };
      }),

      /**
       * Validates a stored or env var API key against a custom or default base URL.
       * Gets API key from DB or env var and validates against the provided URL (or default if not provided).
       */
      validateKeyWithCustomUrl: policy("project:update")(
        procedure.input(modelProviderValidateKeyWithCustomUrlTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        const { projectId, provider, customBaseUrl } = input;
        return ports.validateKeyWithCustomUrl({
          projectId,
          provider,
          customBaseUrl,
          // The probe is written against the service, so the application hands
          // over the one it was composed with rather than this transport
          // holding a second.
          modelProviders: ctx.app.modelProviders.providerService,
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
       * Cascade-resolve a single feature key for a project. Wraps
       * `resolveModelForFeature` for frontend consumers that used to read
       * `project.defaultModel` / etc directly. Returns null when nothing
       * is configured at any scope rather than throwing, so the caller can
       * render a placeholder selector + a "configure a default" hint
       * without an exception-based control flow.
       */
      getResolvedDefault: policy("project:view")(
        procedure.input(modelDefaultResolvedTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return ctx.app.modelProviders.tryGetResolvedDefault({
          projectId: input.projectId,
          featureKey: input.featureKey,
        });
      }),

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
      getDefaultModelsForProject: policy("project:view")(
        procedure.input(modelProviderProjectTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return ctx.app.modelProviders.getDefaultSnapshot(
          { projectId: input.projectId },
          ctx.actor(),
        );
      }),

      /**
       * Single-key writers used by the provider-create "Set as default"
       * flow and any tactical "change just this role at this scope" UI.
       * Both go through the canonical Model Provider service which finds the (newest)
       * config attached at the scope and updates the matching key in
       * place, or creates a new config if none exists.
       *
       * Scope-aware authz: the tier the caller names picks the permission, and
       * the SERVICE is what applies it —
       * `ModelProviderAuthorizationService.writePermission` maps organization
       * to `organization:manage`, team to `team:manage` and project to
       * `project:update`. The declaration below names `project:manage`
       * instead, so on the project tier the declared permission and the
       * enforced one are not the same; the enforced one is what runs. Pinned
       * by model-provider-authorization.service.unit.test.ts so the pair
       * cannot drift further unnoticed.
       */
      setRoleAssignmentForScope: serviceAuthorizedPolicy({
        reason:
          "the tier is data: the scope the caller names decides the permission, and the service's assertCanWriteDefault is what checks it",
        permissions: ["organization:manage", "team:manage", "project:manage"],
      })(procedure.input(modelDefaultRoleAssignmentTrpcInputSchema)).mutation(
        async ({ input, ctx }) => {
          await ctx.app.modelProviders.setDefault(
            {
              scope: { scopeType: input.scopeType, scopeId: input.scopeId },
              key: input.role,
              model: input.model,
            },
            ctx.actor(),
          );
          return { ok: true };
        },
      ),

      setFeatureOverrideForScope: serviceAuthorizedPolicy({
        reason:
          "the tier is data: the scope the caller names decides the permission, and the service's assertCanWriteDefault is what checks it",
        permissions: ["organization:manage", "team:manage", "project:manage"],
      })(procedure.input(modelDefaultFeatureOverrideTrpcInputSchema)).mutation(
        async ({ input, ctx }) => {
          await ctx.app.modelProviders.setDefault(
            {
              scope: { scopeType: input.scopeType, scopeId: input.scopeId },
              key: input.featureKey,
              model: input.model,
            },
            ctx.actor(),
          );
          return { ok: true };
        },
      ),

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
      saveDefaultModelsConfig: serviceAuthorizedPolicy({
        reason:
          "the tier is data: each scope the caller picks decides its own permission, and the service's assertCanWriteDefault is what checks them",
        permissions: ["organization:manage", "team:manage", "project:manage"],
      })(procedure.input(modelDefaultConfigSaveTrpcInputSchema)).mutation(
        async ({ input, ctx }) => {
          const saved = await ctx.app.modelProviders.saveDefaultConfig(input, ctx.actor());
          return { id: saved.id };
        },
      ),

      /**
       * Delete a config (and all its scope attachments cascade). The
       * caller must hold the matching manage permission on every scope
       * the config is currently attached to.
       */
      deleteDefaultModelsConfig: serviceAuthorizedPolicy({
        reason:
          "the scopes are the stored row's, not the caller's input, so only the service can know which permissions to require",
        permissions: ["organization:manage", "team:manage", "project:manage"],
      })(procedure.input(modelDefaultConfigDeleteTrpcInputSchema)).mutation(
        async ({ input, ctx }) => {
          await ctx.app.modelProviders.deleteDefaultConfig({ id: input.id }, ctx.actor());
          return { ok: true };
        },
      ),

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
      getInheritedValuesForScopes: policy("project:view")(
        procedure.input(modelDefaultInheritedValuesTrpcInputSchema),
      ).query(async ({ input, ctx }) => {
        return ctx.app.modelProviders.getInheritedValues({
          projectId: input.projectId,
          scopes: input.scopes,
          excludeConfigId: input.excludeConfigId,
        });
      }),
    });
  }
}
