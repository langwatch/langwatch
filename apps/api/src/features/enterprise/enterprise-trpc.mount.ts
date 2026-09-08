/**
 * Forwards three of the composition's five routers; `subscription`/`currency`
 * mount separately in `enterprise-billing-trpc.mount.ts`.
 */
import {
  CURRENCY_NO_PERMISSION,
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
  type EnterpriseTrpcContext,
} from "@langwatch/enterprise-api";
import { appTrpcNoPermissionPolicy, appTrpcPolicy, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The one capability the Enterprise surfaces reach that no package owns: the
 * plan gate a SCIM token is minted behind.
 */
export type EnterpriseTrpcMountPorts = Parameters<
  typeof EnterpriseTrpcComposition.create
>[0]["ports"];

/** The three Enterprise namespaces this process mounts. */
export function createEnterpriseTrpcRouters<
  TContext extends EnterpriseTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & Readonly<{ ports: EnterpriseTrpcMountPorts }>) {
  const noPermission = appTrpcNoPermissionPolicy(mount.middlewares);
  const { license, licenseEnforcement, scimToken } = EnterpriseTrpcComposition.create({
    root: mount.root,
    protectedProcedure: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
    instanceLicensePolicy: noPermission(INSTANCE_LICENSE_NO_PERMISSION),
    currencyPolicy: noPermission(CURRENCY_NO_PERMISSION),
    // See the module docblock: this process bills nothing and quotes nobody.
    saasBilling: false,
    validateOutput: mount.validateOutput ?? false,
    ports: mount.ports,
  });

  return { license, licenseEnforcement, scimToken };
}
