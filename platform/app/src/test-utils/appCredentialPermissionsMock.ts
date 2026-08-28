import type { PrismaClient } from "~/generated/prisma/client";
import { ForkAwareCredentialDecisionRepository } from "~/server/app-layer/permissions/credential-decision.repository";
import { PermissionsService } from "~/server/app-layer/permissions/permissions.service";

const unstubbed = () => {
  throw new Error(
    "user-grant decisions are not stubbed by appCredentialPermissionsMock",
  );
};

/**
 * Factory body for `vi.mock("~/server/app-layer/app", ...)` in tests that
 * exercise the CREDENTIAL (API-key) check path: the real service + credential
 * repository over the `role-binding-resolver` module, so a test's
 * `vi.mock("~/server/rbac/role-binding-resolver")` stub keeps deciding.
 * Separate from `appPermissionsMock` because this half's module graph pulls
 * the resolver's own imports, which user-grant tests deliberately avoid.
 *
 * `prisma` backs only `findProjectScope` (the project tenancy lookup); pass
 * a fake with `project.findUnique` when the test reaches it.
 */
export function appCredentialPermissionsMock(prisma?: unknown) {
  const permissions = new PermissionsService({
    decisions: {
      findProjectDecision: unstubbed,
      findProjectAnyDecision: unstubbed,
      findTeamDecision: unstubbed,
      findOrganizationDecision: unstubbed,
    },
    credentials: new ForkAwareCredentialDecisionRepository(
      (prisma ?? {}) as PrismaClient,
    ),
  });
  return {
    getApp: () => ({ permissions }),
    tryGetApp: () => null,
  };
}
