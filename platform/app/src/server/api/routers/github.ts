/**
 * tRPC router for the organization's GitHub connection.
 *
 *   getConnectionStatus: the settings surface and every "is GitHub connected?"
 *                        check: the org's installations (account, repository
 *                        selection, suspended), whether the App is configured
 *                        on this instance, and where to start an install.
 *   listRepos:           the repositories reachable across those installations.
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
 * Transport only: gates, audit, and delegation to the app-layer service. The
 * install flow itself is the public REST callback in
 * src/server/routes/github.ts (GitHub's Setup URL can't live behind tRPC).
 *
 * Spec: specs/integrations/github-connection.feature.
 */

import { auditLog } from "@ee/audit-log/auditLog";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  checkOrganizationPermission,
  checkProjectPermission,
  type PermissionMiddleware,
} from "~/server/api/rbac";
import { getApp } from "~/server/app-layer";
import { GithubNotConnectedError } from "~/server/app-layer/github/errors";
import { MAX_STATUS_REFS } from "~/server/app-layer/github/github-pull-request-status.service";
import { getGithubAppConfig } from "~/server/app-layer/github/githubAppConfig";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import { createTRPCRouter, protectedProcedure } from "../trpc";

async function ensureOrganizationMember(
  userId: string,
  organizationId: string,
): Promise<void> {
  const isMember = await getApp().github.installations.isOrganizationMember({
    userId,
    organizationId,
  });
  if (!isMember) {
    // Generic message — echoing the org id would confirm a valid id to a
    // non-member (light enumeration oracle).
    throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
  }
}

/**
 * Defence in depth behind `checkOrganizationPermission`, and the reason it runs
 * second: the permission check answers "may this caller act on an organization
 * at all", and membership then answers "is this one theirs". Membership alone is
 * role-blind, so an EXTERNAL lite member could enumerate the org's private
 * repositories through `listRepos`; the permission check is the real gate, and
 * this keeps a permitted caller inside their own tenant.
 */
const enforceOrganizationMembership: PermissionMiddleware<{
  organizationId: string;
}> = async ({ ctx, input, next }) => {
  await ensureOrganizationMember(ctx.session.user.id, input.organizationId);
  return next();
};

// GitHub can only be uninstalled by a human on github.com. Deep-link to the
// right settings page for the account type.
function uninstallUrl(installation: {
  accountLogin: string;
  accountType: string;
  installationId: string;
}): string {
  if (installation.accountType === "Organization") {
    return `https://github.com/organizations/${installation.accountLogin}/settings/installations/${installation.installationId}`;
  }
  return `https://github.com/settings/installations/${installation.installationId}`;
}

/**
 * Where an install starts, or null on an instance that cannot start one. Built
 * here so no client needs to know the App slug, or that the flow begins with a
 * REST redirect at all.
 *
 * Null takes the same reading of "configured" the install route itself takes,
 * which includes the App slug the deep link is built from. Reading it any other
 * way hands the customer a button whose only possible outcome is the route's
 * 503.
 */
function installUrl(organizationId: string): string | null {
  if (!getGithubAppConfig().configured) return null;
  return `/api/github/install?organizationId=${encodeURIComponent(organizationId)}`;
}

export const githubRouter = createTRPCRouter({
  getConnectionStatus: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:view"))
    .use(enforceOrganizationMembership)
    .query(async ({ input }) => {
      const service = getApp().github.installations;
      const installations = await service.getAllForOrganization(
        input.organizationId,
      );
      return {
        // The same reading `installUrl` takes, which includes the App slug the
        // deep link needs. Reporting token readiness here instead said GitHub
        // was available on an instance with no slug, while both install
        // actions were disabled, which is the state this contradiction
        // produced on the settings page.
        configured: getGithubAppConfig().configured,
        connected: installations.length > 0,
        installations: installations.map((i) => ({
          installationId: i.installationId,
          accountLogin: i.accountLogin,
          accountType: i.accountType,
          repositorySelection: i.repositorySelection,
          // Known only for a "selected" install; "all" resolves live.
          repositoryCount:
            i.repositorySelection === "selected"
              ? (i.repositories?.length ?? 0)
              : null,
          suspended: i.suspendedAt != null,
          uninstallUrl: uninstallUrl(i),
        })),
        installUrl: installUrl(input.organizationId),
      };
    }),

  listRepos: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .use(enforceOrganizationMembership)
    .query(async ({ input }) => {
      return getApp().github.installations.listRepositoriesForOrganization(
        input.organizationId,
      );
    }),

  /**
   * The current status of the pull requests on a page, read live from GitHub
   * (Redis-cached for a minute) with the stored snapshot as the fallback.
   *
   * Project-scoped rather than organization-scoped, because that is how the
   * caller reaches it: they are looking at a project's sessions, and the
   * organization is resolved here from the project rather than taken from the
   * client, so a caller cannot ask about another tenant's pull requests by
   * naming its id.
   */
  pullRequestLiveStatus: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        refs: z
          .array(
            z.object({
              repositoryHost: z.string().min(1),
              repositoryFullName: z.string().min(1),
              prNumber: z.number().int().positive(),
            }),
          )
          .max(MAX_STATUS_REFS),
      }),
    )
    .use(checkProjectPermission("traces:view"))
    .query(async ({ input }) => {
      const organizationId = await resolveOrganizationId(input.projectId);
      if (!organizationId) return { statuses: [] };
      const statuses =
        await getApp().github.pullRequests.status.getLiveStatuses({
          organizationId,
          refs: input.refs,
        });
      return { statuses };
    }),

  disconnect: protectedProcedure
    .input(z.object({ organizationId: z.string(), installationId: z.string() }))
    .use(checkOrganizationPermission("organization:manage"))
    .use(enforceOrganizationMembership)
    .mutation(async ({ ctx, input }) => {
      const installation =
        await getApp().github.installations.getByInstallationId(
          input.installationId,
        );
      // Cross-tenant guard: the installation must belong to this org. One owned
      // by another organization is reported exactly as a missing one, so the id
      // cannot be probed.
      if (
        !installation ||
        installation.organizationId !== input.organizationId
      ) {
        throw new GithubNotConnectedError(input.organizationId);
      }
      await auditLog({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        action: "github.connection.disconnect",
        args: { installationId: input.installationId },
      });
      // We can't uninstall via the API — hand back the deep link; the webhook
      // removes the local row once GitHub confirms the uninstall.
      return { uninstallUrl: uninstallUrl(installation) };
    }),
});
