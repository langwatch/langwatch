/**
 * App-process transport mount for the four Enterprise tRPC surfaces this
 * process serves.
 *
 *   license.*             the signed instance licence and its single sign-on gate
 *   licenseEnforcement.*  the seat and resource limits that licence carries
 *   scimToken.*           the directory-sync credentials an organization mints
 *   ssoConnections.*      the back office's single sign-on connection ledger
 *
 * Behaviour is package-owned and reached through ONE seam:
 * `EnterpriseTrpcComposition` in `@langwatch/enterprise-api`. A core process may
 * not depend on an Enterprise feature package, so this mount imports the
 * composition and nothing below it — which is also why the four routers arrive
 * together rather than one mount per feature.
 *
 * ## Why `subscription` and `currency` are not returned HERE
 *
 * The composition builds all six and this mount forwards four. The two billing
 * surfaces belong to the gateway group, which mounts them directly from
 * `@langwatch/enterprise-billing-server` beside the twenty-one gateway and
 * governance namespaces — see `enterprise-billing-trpc.mount.ts`. They are on
 * the record: a client asking what this deployment charges has to be able to
 * tell "this installation does not bill" from "the call failed", and a
 * namespace that is not there tells it neither.
 *
 * `saasBilling` is passed as `false` here because this mount returns neither of
 * them, so the two routers the composition would build are never read. The
 * deployment's real answer reaches the billing mount instead.
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
      ports: mount.ports,
    });

  return { license, licenseEnforcement, scimToken, ssoConnections };
}
