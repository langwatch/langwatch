/**
 * Forwards the composition's SCIM-token router; `subscription` and `currency`
 * mount on this process's own declared runtime in `app-trpc.features.ts`, and
 * the two licensing namespaces in `licensing-trpc.mount.ts`.
 */
import { EnterpriseTrpcComposition, type EnterpriseTrpcContext } from "@langwatch/enterprise-api";
import { appTrpcPolicy, type TrpcApiMount } from "@langwatch/api/trpc";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

/**
 * The one capability the Enterprise surfaces reach that no package owns: the
 * plan gate a SCIM token is minted behind.
 */
export type EnterpriseTrpcMountPorts = Parameters<
  typeof EnterpriseTrpcComposition.create
>[0]["ports"];

/** The Enterprise namespace this process mounts through the composition. */
export function createEnterpriseTrpcRouters<
  TContext extends EnterpriseTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & Readonly<{ ports: EnterpriseTrpcMountPorts }>) {
  const { scimToken } = EnterpriseTrpcComposition.create({
    root: mount.root,
    protectedProcedure: mount.protectedProcedure,
    policy: appTrpcPolicy(mount.middlewares),
    validateOutput: mount.validateOutput ?? false,
    ports: mount.ports,
  });

  return { scimToken };
}
