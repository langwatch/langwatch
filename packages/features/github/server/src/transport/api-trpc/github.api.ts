/** Organization connection, repository, pull-request status and disconnect queries. */
import { createTrpcService, type TrpcPolicyDecorator } from "@langwatch/api/trpc";
import type { AuthzDeclaration, AuthzPermission } from "@langwatch/authz-contract";
import {
  githubConnectionStatusSchema,
  githubDisconnectResultSchema,
  githubPullRequestLiveStatusesSchema,
  githubPullRequestRefSchema,
  githubRepositoryRefSchema,
  type GithubApi,
} from "@langwatch/github-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type GithubApplication = Readonly<{ github: GithubApi }>;

/** The process supplies authentication; authorization arrives as `policy`. */
export type GithubTrpcContext = Readonly<{
  app: GithubApplication;
  actor(): Readonly<{ id: string }>;
}>;

type GithubTrpcProcedures<
  TContext extends GithubTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
> = Readonly<{
  /** The process's authenticated procedure. */
  protected: TRPCRootObject<TContext, object, TOptions, TRoot>["procedure"];
  /** Process policy for one declared permission, applied after input parsing. */
  policy(access: AuthzPermission | AuthzDeclaration): TrpcPolicyDecorator;
  /** @see the mount field of the same name. */
  validateOutput: boolean;
}>;

/** Process capabilities this transport needs besides GitHub. */
type GithubTrpcPorts = Readonly<{
  /** Resolves a project's organization; orphan projects are absent. */
  tryResolveOrganizationForProject(projectId: string): Promise<string | undefined>;
  /** The process's audit trail. */
  recordAudit(
    entry: Readonly<{
      userId: string;
      organizationId: string;
      action: string;
      args: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<void>;
}>;

const organizationScopeSchema = z.object({ organizationId: z.string() });

const disconnectInputSchema = z.object({
  organizationId: z.string(),
  installationId: z.string(),
});

const pullRequestLiveStatusInputSchema = z.object({
  projectId: z.string(),
  refs: z.array(githubPullRequestRefSchema).max(50),
});

/** Confirms membership after the declared organization permission check. */
async function ensureOrganizationMember(
  userId: string,
  organizationId: string,
  service: GithubApi,
): Promise<void> {
  const isMember = await service.isOrganizationMember({ userId, organizationId });
  if (!isMember) {
    // Generic message — echoing the organization id would confirm a valid id
    // to a non-member (light enumeration oracle).
    throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
  }
}

/** Installs the GitHub tRPC surface over the process-owned policy and root. */
export class GithubTrpcApi {
  static create<
    TContext extends GithubTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: GithubTrpcProcedures<TContext, TOptions, TRoot>,
    ports: GithubTrpcPorts,
  ) {
    const { protected: procedure, policy } = procedures;

    return (
      createTrpcService({
        root: trpc,
        procedures: { protected: procedure, policy },
        validateOutput: procedures.validateOutput,
      })
        .query("getConnectionStatus", (p) =>
          p
            .withInput(organizationScopeSchema)
            .withOutput(githubConnectionStatusSchema)
            .withPermission("organization:view")
            .handle(async ({ ctx, input }) => {
              const actor = ctx.actor();
              await ensureOrganizationMember(actor.id, input.organizationId, ctx.app.github);
              return ctx.app.github.getConnectionStatus({ organizationId: input.organizationId });
            }),
        )
        .query("listRepos", (p) =>
          p
            .withInput(organizationScopeSchema)
            .withOutput(githubRepositoryRefSchema.array())
            .withPermission("organization:manage")
            .handle(async ({ ctx, input }) => {
              const actor = ctx.actor();
              await ensureOrganizationMember(actor.id, input.organizationId, ctx.app.github);
              return ctx.app.github.listRepositoriesForOrganization(input.organizationId);
            }),
        )
        /**
         * The current status of the pull requests on a page, read live from
         * GitHub (cached briefly) with the stored snapshot as the fallback.
         */
        .query("pullRequestLiveStatus", (p) =>
          p
            .withInput(pullRequestLiveStatusInputSchema)
            .withOutput(githubPullRequestLiveStatusesSchema)
            .withPermission("traces:view")
            .handle(async ({ ctx, input }) => {
              const organizationId = await ports.tryResolveOrganizationForProject(input.projectId);
              if (!organizationId) return { statuses: [] };
              const statuses = await ctx.app.github.getLivePullRequestStatuses({
                organizationId,
                refs: input.refs,
              });
              return { statuses };
            }),
        )
        .mutation("disconnect", (p) =>
          p
            .withInput(disconnectInputSchema)
            .withOutput(githubDisconnectResultSchema)
            .withPermission("organization:manage")
            .handle(async ({ ctx, input }) => {
              const actor = ctx.actor();
              await ensureOrganizationMember(actor.id, input.organizationId, ctx.app.github);
              // Throws `GithubNotConnectedError` when the organization has no such
              // installation, which is also how one owned by another organization
              // answers — the id cannot be probed.
              const result = await ctx.app.github.disconnect({
                organizationId: input.organizationId,
                installationId: input.installationId,
              });
              await ports.recordAudit({
                userId: actor.id,
                organizationId: input.organizationId,
                action: "github.connection.disconnect",
                args: { installationId: input.installationId },
              });
              // We can't uninstall via the API — hand back the deep link; the webhook
              // removes the local row once GitHub confirms the uninstall.
              return result;
            }),
        )
        .build()
    );
  }
}
