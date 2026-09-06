/**
 * Provider writes and the credential probe have data-dependent tenant
 * anchors, so both arrive as middlewares on the `custom` chain.
 */
import { createTrpcApiService, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import type { EnforcedScopeFields } from "@langwatch/authz-contract";
import {
  LlmModelCostTrpcApi,
  ModelProviderTrpcApi,
  type LlmModelCostTrpcContext,
  type LlmModelCostTrpcPorts,
  type ModelProviderTrpcContext,
  type ModelProviderTrpcPorts,
} from "@langwatch/model-provider-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The two data-dependent gates the provider surface needs, built by the
 * process because each resolves its tenant anchor from the request rather than
 * from a permission name.
 */
export type ModelProviderTrpcChecks = Readonly<{
  /**
   * Project permission when a project is named, org membership otherwise;
   * the service decides what the caller may write per scope.
   */
  tenantWrite(permission: "project:update" | "project:delete"): unknown;
  /**
   * The gate for the credential probe. Nothing downstream re-authorizes it, so
   * this IS the authorization: with a project it is `project:update`, and
   * without one it runs the same per-scope check a provider write does.
   */
  credentialProbe: unknown;
}>;

/** Mounts `modelProvider.*` on the app process's tRPC root. */
export function createModelProviderTrpcRouter<
  TContext extends ModelProviderTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TApiKeyValidation,
  TStoredKeyValidation,
>(
  mount: TrpcApiMount<TContext, TOptions, TRoot> &
    TrpcApiPorts<ModelProviderTrpcPorts<TApiKeyValidation, TStoredKeyValidation>> &
    Readonly<{ checks: ModelProviderTrpcChecks }>,
) {
  const service = createTrpcApiService(mount);
  return ModelProviderTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: (permission) => service.policy(permission),
      tenantWritePolicy: (permission) => service.custom(mount.checks.tenantWrite(permission)),
      credentialProbePolicy: service.custom(mount.checks.credentialProbe),
      serviceAuthorizedPolicy: (options) => service.serviceAuthorized(options),
      validateOutput: service.validateOutput,
    },
    mount.ports,
  );
}

/** Mounts `llmModelCost.*` on the app process's tRPC root. */
export function createLlmModelCostTrpcRouter<
  TContext extends LlmModelCostTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends LlmModelCostTrpcPorts,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<TPorts>) {
  const service = createTrpcApiService(mount);
  return LlmModelCostTrpcApi.create(
    mount.root,
    {
      protected: service.protected,
      policy: (permission) => service.policy(permission),
      // The resolver loads the scope this write lands on, so the declaration
      // names the input fields it is claiming to have covered. The sweep
      // counts a claimed field as covered, so `enforces` has to travel.
      resolverAuthorizedPolicy: (enforces: EnforcedScopeFields) =>
        service.serviceAuthorized({
          reason:
            "a custom cost rule is written against the scope its resolver loads at runtime, which is where the per-scope manage permission is enforced",
          permissions: ["project:update", "team:manage", "organization:manage"],
          enforces,
        }),
      validateOutput: service.validateOutput,
    },
    mount.ports,
  );
}
