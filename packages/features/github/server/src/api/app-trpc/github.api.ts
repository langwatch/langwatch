/**
 * The organization's GitHub connection over the process's tRPC transport.
 *
 *   getConnectionStatus: the settings surface and every "is GitHub connected?"
 *                        check: the organization's installations (account,
 *                        repository selection, suspended), whether the App is
 *                        configured on this instance, and where to start an
 *                        install.
 *   listRepos:           the repositories reachable across those installations.
 *   pullRequestLiveStatus: the current state of the pull requests on a page.
 *   disconnect:          GitHub can't be uninstalled via the API, so this
 *                        returns a deep link to GitHub's uninstall page; the
 *                        webhook cleans up the local row once GitHub confirms.
 *
 * Reading the connection state takes only membership plus `organization:view`,
 * which every member holds, so a surface that needs GitHub can tell the user to
 * ask an admin rather than pretend nothing is there. Changing it takes
 * `organization:manage`, because an installation grants repository access to the
 * whole organization.
 *
 * Transport only: gates, audit, and delegation to `GithubService`. The install
 * flow itself is the public REST callback the process mounts (GitHub's Setup
 * URL can't live behind tRPC).
 *
 * Spec: specs/integrations/github-connection.feature.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import { githubPullRequestRefSchema, type GithubService } from "@langwatch/github-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";

type GithubApplication = Readonly<{ github: GithubService }>;

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
  /**
   * The process's tracing, logging, error, scope-lineage, authorization and
   * audit policy for one declared permission.
   *
   * Applied by this feature AFTER its own input parser rather than composed
   * ahead of it, because the authorization check reads its scope id from the
   * validated input: tRPC runs middlewares in the order they were added, so a
   * check installed before `.input()` would see no input at all.
   */
  policy(permission: AuthzPermission): <TProcedure>(procedure: TProcedure) => TProcedure;
}>;

/**
 * The process capabilities this transport needs that are not GitHub's own.
 */
type GithubTrpcPorts = Readonly<{
  /**
   * The organization a project belongs to, or undefined for an orphan project.
   * The pull-request read is project-scoped because that is how the caller
   * reaches it, and the organization is derived here rather than taken from
   * the client, so a caller cannot ask about another tenant's pull requests by
   * naming its id.
   */
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

/**
 * Defence in depth behind the declared `organization:*` check, and the reason
 * it runs second: the permission check answers "may this caller act on an
 * organization at all", and membership then answers "is this one theirs".
 * Membership alone is role-blind, so an EXTERNAL lite member could enumerate
 * the organization's private repositories through `listRepos`; the permission
 * check is the real gate, and this keeps a permitted caller inside their own
 * tenant.
 */
async function ensureOrganizationMember(
  userId: string,
  organizationId: string,
  service: GithubService,
): Promise<void> {
  const isMember = await service.isOrganizationMember({ userId, organizationId });
  if (!isMember) {
    // Generic message — echoing the organization id would confirm a valid id
    // to a non-member (light enumeration oracle).
    throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
  }
}

/**
 * Installs the complete `github.*` tRPC surface on a process-owned root. The
 * procedure and the policy are injected by the process so its auth, audit,
 * error, logging and tracing policies wrap every feature procedure
 * consistently.
 */
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

    return trpc.router({
      getConnectionStatus: policy("organization:view")(
        procedure.input(organizationScopeSchema),
      ).query(async ({ ctx, input }) => {
        const actor = ctx.actor();
        await ensureOrganizationMember(actor.id, input.organizationId, ctx.app.github);
        return ctx.app.github.getConnectionStatus({ organizationId: input.organizationId });
      }),

      listRepos: policy("organization:manage")(procedure.input(organizationScopeSchema)).query(
        async ({ ctx, input }) => {
          const actor = ctx.actor();
          await ensureOrganizationMember(actor.id, input.organizationId, ctx.app.github);
          return ctx.app.github.listRepositoriesForOrganization(input.organizationId);
        },
      ),

      /**
       * The current status of the pull requests on a page, read live from
       * GitHub (cached briefly) with the stored snapshot as the fallback.
       */
      pullRequestLiveStatus: policy("traces:view")(
        procedure.input(pullRequestLiveStatusInputSchema),
      ).query(async ({ ctx, input }) => {
        const organizationId = await ports.tryResolveOrganizationForProject(input.projectId);
        if (!organizationId) return { statuses: [] };
        const statuses = await ctx.app.github.getLivePullRequestStatuses({
          organizationId,
          refs: input.refs,
        });
        return { statuses };
      }),

      disconnect: policy("organization:manage")(procedure.input(disconnectInputSchema)).mutation(
        async ({ ctx, input }) => {
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
        },
      ),
    });
  }
}
