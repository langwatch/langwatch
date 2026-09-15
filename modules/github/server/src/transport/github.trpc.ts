/**
 * The server half of `github.*`: the organization's connection, the
 * repositories it reaches, the live pull-request read and the disconnect.
 * @see specs/integrations/github-connection.feature
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import {
  githubTrpc,
  GithubOrganizationMembershipRequiredError,
  type GithubApi,
  type GithubConnectionAuditEntry,
} from "@langwatch/github-contract";
import { moduleApi } from "@langwatch/runtime-composition";

/**
 * What the connection door reaches. The GitHub capability is this module's; the
 * project's organization and the audit trail belong to the DEPLOYMENT, so they
 * are named here beside it rather than reached for.
 */
export interface GithubConnectionApi {
  /** This module's own GitHub capability, as the process composed it. */
  github(): GithubApi;
  /** The organization a project belongs to; an orphan project has none. */
  findOrganizationForProject(projectId: string): Promise<string | undefined>;
  /** Where a connection command is recorded. */
  recordAudit(entry: GithubConnectionAuditEntry): Promise<void>;
}

export const GithubConnectionApi = moduleApi<GithubConnectionApi>("github");

/**
 * Membership is asked AFTER the declared permission and BEFORE any connection
 * state is read: a permission can be held at a wider scope than the one the
 * input names, and a non-member's answer must not depend on the organization.
 */
async function requireOrganizationMember({
  app,
  userId,
  organizationId,
}: {
  app: GithubConnectionApi;
  userId: string;
  organizationId: string;
}): Promise<void> {
  const isMember = await app.github().isOrganizationMember({ userId, organizationId });

  if (!isMember) throw new GithubOrganizationMembershipRequiredError();
}

export const githubTrpcTransport = defineTrpcRouter(GithubConnectionApi, githubTrpc)
  .procedure("getConnectionStatus")
  .withPermission("organization:view")
  .handle(async ({ app, input, actor }) => {
    await requireOrganizationMember({
      app,
      userId: actor.id,
      organizationId: input.organizationId,
    });

    return app.github().getConnectionStatus({ organizationId: input.organizationId });
  })

  // `organization:manage`, because an installation grants repository access to
  // the whole organization and this is the list of what it reaches.
  .procedure("listRepos")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await requireOrganizationMember({
      app,
      userId: actor.id,
      organizationId: input.organizationId,
    });

    const repositories = await app.github().listRepositoriesForOrganization(input.organizationId);

    return [...repositories];
  })

  // `traces:view`, because what this reveals is what a coding-agent session did
  // rather than anything about the connection. The organization is derived from
  // the project, never taken from the client.
  .procedure("pullRequestLiveStatus")
  .withPermission("traces:view")
  .handle(async ({ app, input }) => {
    const organizationId = await app.findOrganizationForProject(input.projectId);

    if (!organizationId) return { statuses: [] };

    const statuses = await app.github().getLivePullRequestStatuses({
      organizationId,
      refs: input.refs,
    });

    return { statuses: [...statuses] };
  })

  .procedure("disconnect")
  .withPermission("organization:manage")
  .handle(async ({ app, input, actor }) => {
    await requireOrganizationMember({
      app,
      userId: actor.id,
      organizationId: input.organizationId,
    });

    // Throws `GithubNotConnectedError` when the organization has no such
    // installation, which is also how one owned by another organization
    // answers — the id cannot be probed. No audit line is left for a refusal.
    const result = await app.github().disconnect({
      organizationId: input.organizationId,
      installationId: input.installationId,
    });

    await app.recordAudit({
      userId: actor.id,
      organizationId: input.organizationId,
      action: "github.connection.disconnect",
      args: { installationId: input.installationId },
    });

    // We cannot uninstall through the API — hand back the deep link; the
    // webhook removes the local row once GitHub confirms the uninstall.
    return result;
  })
  .build();
