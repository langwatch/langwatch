/**
 * The organization is derived from the project, never taken from the
 * client, so a caller can't name another tenant's organization directly.
 */
import { appTrpcPolicy, type TrpcApiMount, type TrpcApiPorts } from "@langwatch/api/trpc";
import { GithubTrpcApi, type GithubTrpcContext } from "@langwatch/github-server";
import type { AnyTRPCRootTypes, TRPCRuntimeConfigOptions } from "@trpc/server";

export type { GithubTrpcContext };

/** The two capabilities `github.*` reaches that the GitHub feature does not own. */
export type GithubTrpcMountPorts = Parameters<typeof GithubTrpcApi.create>[2];

/** Mounts `github.*` on the app process's tRPC root, under the key clients call. */
export function createGithubTrpcRouter<
  TContext extends GithubTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
  TPorts extends GithubTrpcMountPorts,
>(mount: TrpcApiMount<TContext, TOptions, TRoot> & TrpcApiPorts<TPorts>) {
  return GithubTrpcApi.create(
    mount.root,
    {
      protected: mount.protectedProcedure,
      policy: appTrpcPolicy(mount.middlewares),
      validateOutput: mount.validateOutput ?? false,
    },
    mount.ports,
  );
}
