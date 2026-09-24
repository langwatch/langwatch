import {
  hasOrganizationPermission,
  organizationDenialReason,
  resolveProjectPermission,
  resolveProjectPermissionAny,
  resolveTeamPermission,
} from "~/server/app-layer/authz/permission-adapters";
import { PermissionsService } from "~/server/app-layer/permissions/permissions.service";
import { prisma } from "~/server/db";

/** Existing transport tests stub these adapters; production uses the engine directly. */
function contextFor(userId: string) {
  return { prisma, session: { user: { id: userId }, expires: "" } };
}

export function appPermissionsService(): PermissionsService {
  return new PermissionsService({
    decisions: {
      findProjectDecision: ({ userId, projectId, permission }) =>
        resolveProjectPermission(contextFor(userId), projectId, permission),
      findProjectAnyDecision: ({ userId, projectId, permissions }) =>
        resolveProjectPermissionAny(contextFor(userId), projectId, permissions),
      findTeamDecision: ({ userId, teamId, permission }) =>
        resolveTeamPermission(contextFor(userId), teamId, permission),
      findOrganizationDecision: async ({
        userId,
        organizationId,
        permission,
      }) => {
        const ctx = contextFor(userId);
        const permitted = await hasOrganizationPermission(
          ctx,
          organizationId,
          permission,
        );
        return {
          permitted,
          organizationRole: null,
          ...(permitted
            ? {}
            : {
                denialReason: await organizationDenialReason({
                  ctx,
                  organizationId,
                }),
              }),
        };
      },
    },
    // Credential (API-key) checks are a different seam with a heavier module
    // graph; a test that needs them mocks the credential path itself.
    credentials: {
      findApiKeyDecision: () => {
        throw new Error(
          "credential checks are not stubbed by appPermissionsMock",
        );
      },
      findApiKeyProjectDecisions: () => {
        throw new Error(
          "credential checks are not stubbed by appPermissionsMock",
        );
      },
      findProjectScope: () => {
        throw new Error(
          "credential checks are not stubbed by appPermissionsMock",
        );
      },
    },
  });
}

export function appPermissionsMock() {
  const permissions = appPermissionsService();
  return {
    getApp: () => ({ permissions }),
    tryGetApp: () => null,
  };
}
