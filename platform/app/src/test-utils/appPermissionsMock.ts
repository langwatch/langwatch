import type {
  AuthzGetDecisionInput,
  AuthzGetProjectAnyDecisionInput,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { AuthzFeature } from "~/runtime/app/features/authz";
import {
  hasOrganizationPermission,
  resolveProjectPermission,
  resolveProjectPermissionAny,
  resolveTeamPermission,
} from "~/server/api/rbac";

class TestAuthzDatabaseAdapter {
  static create(database: unknown): PrismaClient {
    const root = (database ?? {}) as Record<PropertyKey, unknown>;
    return new Proxy(root, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (value !== undefined) {
          return TestAuthzDatabaseAdapter.delegate(value);
        }
        return TestAuthzDatabaseAdapter.delegate({});
      },
    }) as unknown as PrismaClient;
  }

  private static delegate(value: unknown): unknown {
    if (typeof value !== "object" || value === null) return value;
    return new Proxy(value as Record<PropertyKey, unknown>, {
      get(target, property, receiver) {
        const member = Reflect.get(target, property, receiver);
        if (member !== undefined) return member;
        if (property === "findMany") return async () => [];
        if (property === "count") return async () => 0;
        return async () => null;
      },
    });
  }
}

/** Test adapter that keeps legacy resolver mocks behind the contract service. */
class ResolverBackedTestAuthzService {
  constructor(private readonly prisma: unknown = {}) {}

  async getDecision({
    userId,
    permission,
    scope,
  }: AuthzGetDecisionInput): Promise<PermissionDecision> {
    const context = {
      prisma: this.prisma as never,
      session: { user: { id: userId }, expires: "" },
    };
    switch (scope.tier) {
      case "project":
        return resolveProjectPermission(context, scope.id, permission);
      case "team":
        return resolveTeamPermission(context, scope.id, permission);
      case "organization":
        return {
          permitted: await hasOrganizationPermission(
            context,
            scope.id,
            permission,
          ),
          organizationRole: null,
        };
    }
  }

  getProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision> {
    return resolveProjectPermissionAny(
      {
        prisma: this.prisma as never,
        session: { user: { id: userId }, expires: "" },
      },
      projectId,
      permissions,
    );
  }
}

export function appPermissionsService(prisma?: unknown): AuthzService {
  return AuthzFeature.create({
    database: TestAuthzDatabaseAdapter.create(prisma),
    redis: null,
    newBindingId: () => "authz-test-binding",
    cacheEnabled: () => false,
    demoProjectId: () => undefined,
  }).permissions;
}

export function appPermissionsMock() {
  const permissions =
    new ResolverBackedTestAuthzService() as unknown as AuthzService;
  return {
    getApp: () => ({ permissions }),
    tryGetApp: () => null,
  };
}
