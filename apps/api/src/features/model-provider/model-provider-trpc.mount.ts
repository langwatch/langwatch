/**
 * App-process transport mounts for the model-provider vertical: the stored
 * provider credentials a project executes against, and the custom cost rules
 * that price the spans those providers produce.
 *
 * Behaviour is package-owned (`@langwatch/model-provider-server`); these supply
 * the process's tRPC root, its authenticated procedure, its policy chain, and
 * the capabilities the feature does not own — the outbound credential probes,
 * the Codex device flow, the audit trail, and the cost rule's live span
 * preview.
 *
 * Both surfaces carry authorization shapes a single permission cannot express,
 * and both arrive here as already-built middlewares rather than as
 * descriptions:
 *
 *  - a provider write may name EITHER a project or an organization, so the
 *    tenant anchor is data-dependent;
 *  - the credential probe goes straight out to the vendor with caller-supplied
 *    keys, so whatever gate sits on it IS the authorization rather than a
 *    coarse pre-filter;
 *  - a cost-rule write authorizes against a scope the resolver loads.
 *
 * `declaredCheckFrom` deliberately refuses `kind: "custom"` — a custom check IS
 * its own middleware, written where the rule lives — which is why the first two
 * ride the process's `custom` chain and the third its `serviceAuthorized` one.
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
   * The gate for a provider write that may arrive with either handle: the
   * project permission when a project is named, organization membership
   * otherwise. What the caller may actually write is then decided per scope
   * inside the service.
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
    },
    mount.ports,
  );
}
