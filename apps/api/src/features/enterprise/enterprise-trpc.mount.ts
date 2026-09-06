/**
 * Forwards four of the composition's six routers; `subscription`/`currency`
 * mount separately in `enterprise-billing-trpc.mount.ts`.
 */
import {
  BACK_OFFICE_NO_PERMISSION,
  BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION,
  CURRENCY_NO_PERMISSION,
  EnterpriseTrpcComposition,
  INSTANCE_LICENSE_NO_PERMISSION,
  type EnterpriseTrpcContext,
} from "@langwatch/enterprise-api";
import { appTrpcNoPermissionPolicy, appTrpcPolicy, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The two capabilities the Enterprise surfaces reach that no package owns: the
 * plan gate a SCIM token is minted behind, and the back office's connection
 * ledger with the audit trail every command on it is written to.
 */
export type EnterpriseTrpcMountPorts = Parameters<
  typeof EnterpriseTrpcComposition.create
>[0]["ports"];

/** The four Enterprise namespaces this process mounts. */
export function createEnterpriseTrpcRouters<
  TContext extends EnterpriseTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & Readonly<{ ports: EnterpriseTrpcMountPorts }>) {
  const noPermission = appTrpcNoPermissionPolicy(mount.middlewares);
  const { license, licenseEnforcement, scimToken, ssoConnections } =
    EnterpriseTrpcComposition.create({
      root: mount.root,
      protectedProcedure: mount.protectedProcedure,
      policy: appTrpcPolicy(mount.middlewares),
      instanceLicensePolicy: noPermission(INSTANCE_LICENSE_NO_PERMISSION),
      currencyPolicy: noPermission(CURRENCY_NO_PERMISSION),
      backOfficePolicy: noPermission(BACK_OFFICE_NO_PERMISSION),
      backOfficePolicyForOrganization: noPermission(BACK_OFFICE_NO_PERMISSION_FOR_ORGANIZATION),
      // See the module docblock: this process bills nothing and quotes nobody.
      saasBilling: false,
      validateOutput: mount.validateOutput ?? false,
      ports: mount.ports,
    });

  return { license, licenseEnforcement, scimToken, ssoConnections };
}
