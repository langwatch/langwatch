/**
 * tRPC router for the Langy ↔ GitHub App installation.
 *
 *   getInstallStatus — settings + the "installed" chip: the org's installations
 *                      (account, repo selection, suspended) + whether the App is
 *                      configured on this instance.
 *   listRepos        — the repositories reachable across the org's installations.
 *   disconnect       — GitHub can't be uninstalled via the API, so this returns a
 *                      deep link to GitHub's uninstall page; the webhook cleans up
 *                      the local row once GitHub confirms.
 *
 * Transport only: the authoritative Langy internal-only gate
 * (`enforceLangyAccess`) + org-membership gate + audit, delegating every
 * operation to the app-layer service. The gate matters here as much as on the
 * install route — a non-staff org member must not read or manage Langy's GitHub
 * App state while Langy is disabled for the account. The install flow itself is
 * the public REST callback in src/server/routes/github-langy.ts (GitHub's Setup
 * URL can't live behind tRPC). Issue #4747.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  checkOrganizationPermission,
  type PermissionMiddleware,
} from "~/server/api/rbac";
import { getApp } from "~/server/app-layer";
import { auditLog } from "~/server/auditLog";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { enforceLangyAccess } from "./langyAccessMiddleware";

async function ensureOrganizationMember(
  userId: string,
  organizationId: string,
): Promise<void> {
  const isMember = await getApp().langy.githubInstallations.isOrganizationMember(
    { userId, organizationId },
  );
  if (!isMember) {
    // Generic message — echoing the org id would confirm a valid id to a
    // non-member (light enumeration oracle).
    throw new TRPCError({ code: "FORBIDDEN", message: "Forbidden" });
  }
}

/**
 * Defence in depth behind `checkOrganizationPermission("langy:manage")`, and
 * the reason the ordering matters: both run BEFORE the Langy rollout gate. If
 * `enforceLangyAccess` ran first, a signed-in non-member could pass a guessed
 * org id and tell that org's rollout state apart from the response — FORBIDDEN
 * when the flag is on (gate passes, membership fails) vs NOT_FOUND when it is
 * off (gate denies) — a cross-tenant probe of an arbitrary tenant's Langy
 * rollout. Authorizing first makes a non-member's response independent of the
 * org's flag value.
 *
 * This used to be the ONLY gate, paired with `authorizeInResolver` — which
 * authorizes nothing, it just marks the check as done. Membership alone is
 * role-blind, so an EXTERNAL lite member could enumerate the org's private
 * repositories through `listRepos`. The permission check is the real gate now.
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

export const langyGithubRouter = createTRPCRouter({
  getInstallStatus: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("langy:manage"))
    .use(enforceOrganizationMembership)
    .use(enforceLangyAccess)
    .query(async ({ input }) => {
      const service = getApp().langy.githubInstallations;
      const installations = await service.getAllForOrganization(
        input.organizationId,
      );
      return {
        configured: service.configured,
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
      };
    }),

  listRepos: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .use(checkOrganizationPermission("langy:manage"))
    .use(enforceOrganizationMembership)
    .use(enforceLangyAccess)
    .query(async ({ input }) => {
      return getApp().langy.githubInstallations.listRepositoriesForOrganization(
        input.organizationId,
      );
    }),

  disconnect: protectedProcedure
    .input(
      z.object({ organizationId: z.string(), installationId: z.string() }),
    )
    .use(checkOrganizationPermission("langy:manage"))
    .use(enforceOrganizationMembership)
    .use(enforceLangyAccess)
    .mutation(async ({ ctx, input }) => {
      const installation =
        await getApp().langy.githubInstallations.getByInstallationId(
          input.installationId,
        );
      // Cross-tenant guard: the installation must belong to this org.
      if (
        !installation ||
        installation.organizationId !== input.organizationId
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      }
      await auditLog({
        userId: ctx.session.user.id,
        organizationId: input.organizationId,
        action: "langy.github.disconnect",
        args: { installationId: input.installationId },
      });
      // We can't uninstall via the API — hand back the deep link; the webhook
      // removes the local row once GitHub confirms the uninstall.
      return { uninstallUrl: uninstallUrl(installation) };
    }),
});
