/**
 * App-process transport mount for `github.*`: the GitHub App an organization
 * connected, the repositories it reaches, and the pull requests a coding-agent
 * session opened.
 *
 * Behaviour is package-owned (`@langwatch/github-server`); this supplies the
 * process's root, its authenticated procedure and its declared-permission
 * policy chain, plus the two answers the transport reaches that GitHub does not
 * own — which organization a project belongs to, and where a command on the
 * connection is recorded.
 *
 * The organization is derived from the project rather than taken from the
 * client on purpose: the pull-request read is project-scoped because that is
 * how a caller reaches it, and a caller naming an organization id could
 * otherwise ask about another tenant's pull requests.
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
    { protected: mount.protectedProcedure, policy: appTrpcPolicy(mount.middlewares) },
    mount.ports,
  );
}
