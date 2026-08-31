import type {
  AuthzGetDecisionInput,
  AuthzGetProjectAnyDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import type { PrismaClient } from "~/generated/prisma/client";
import { AuthzFeature } from "~/runtime/app/features/authz";

/**
 * The legacy resolvers, fetched when a decision is asked for rather than when
 * this module loads.
 *
 * The repo bans inline `import()`; here the deferral is load-bearing rather
 * than stylistic. Every consumer reaches this module from inside
 * `vi.mock("~/server/app-layer/app", async () => ...)`, so
 * that module's factory is in flight while this one loads. `~/server/api/rbac`
 * imports `~/server/app-layer/app` for its `getApp()` fallbacks, so a static
 * edge to it here closes the ring: the factory awaits an import that awaits the
 * factory, and the suite hangs forever with no error to read. By the time a
 * permission is actually resolved the factory has long since returned, and the
 * import is an already-resolved module lookup.
 *
 * It stays an import of `~/server/api/rbac` — never of the modules underneath
 * it — because that is the specifier the suites mock. Reaching past it would
 * take their `vi.mock("../../rbac")` stubs out of the path.
 */
const legacyResolvers = () => import("~/server/api/rbac");

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
    const { hasOrganizationPermission, resolveProjectPermission, resolveTeamPermission } =
      await legacyResolvers();
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
          permitted: await hasOrganizationPermission(context, scope.id, permission),
          organizationRole: null,
        };
    }
  }

  async getProjectAnyDecision({
    userId,
    projectId,
    permissions,
  }: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision> {
    const { resolveProjectPermissionAny } = await legacyResolvers();
    return resolveProjectPermissionAny(
      {
        prisma: this.prisma as never,
        session: { user: { id: userId }, expires: "" },
      },
      projectId,
      permissions,
    );
  }

  /**
   * The scope-lineage guard runs ahead of every procedure in the policy chain,
   * so a double standing in for `getApp().permissions` has to answer it or the
   * call dies before the permission this suite is about is ever resolved.
   *
   * "Consistent" is the honest answer for what this double models: lineage asks
   * whether the scope ids in one input descend from a common organization, and
   * the legacy resolvers behind this class decide a single scope at a time and
   * have no view of the relationship between two. No suite reaching for this
   * mock makes a claim about lineage — the guard has its own tests, over the
   * real engine — so answering "consistent" leaves each suite's own assertions
   * exactly as strict as they were.
   */
  async checkScopeLineage(): Promise<AuthzScopeLineageResult> {
    return { kind: "consistent" };
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
  const permissions = new ResolverBackedTestAuthzService() as unknown as AuthzService;
  return {
    getApp: () => ({ permissions }),
    tryGetApp: () => null,
  };
}
