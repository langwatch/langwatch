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

/** The stand-in proof the mocked door mints; never a sealed one. */
export const APP_MOCK_AUTHORIZATION = Object.freeze({
  mock: "authorization",
});

export function appPermissionsMock() {
  const permissions = appPermissionsService();
  return {
    getApp: () => ({
      permissions,
      // The door is not under test here: a route checked under a
      // proof-bearing permission gets a stand-in proof so the check's own
      // behaviour can be asserted. A test of the proof itself hands in an
      // App of its own through the context slot.
      authorization: {
        authorize: async () => APP_MOCK_AUTHORIZATION,
      },
    }),
    tryGetApp: () => null,
  };
}
