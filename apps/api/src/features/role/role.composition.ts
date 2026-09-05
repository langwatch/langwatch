/**
 * The roles an organization defines and the teams they are assigned inside, composed as
 * one feature. `role.*` defines a custom role and binds it; `team.*` administers the
 * teams a member is placed in.
 */
import { AuthzApp, KsuidAuthzBindingIdAdapter } from "@langwatch/authz-server";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import { authzPermissionSchema, bindingScopeCanGrantPermission } from "@langwatch/authz-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger, type Logger } from "@langwatch/observability";
import { assertNoPersonalTeamScope, type TeamTrpcPorts } from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RoleBindingScopeType, RoleService } from "@langwatch/role-contract";
import {
  PostgresRoleAdapter,
  RoleApp,
  RolePermissionPort,
  RoleScopePort,
} from "@langwatch/role-server";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import { createTeamTrpcRouter } from "../organization/organization-trpc.mount";
import { createRoleTrpcRouter, type RoleTrpcPorts } from "./role-trpc.mount";

/**
 * The Enterprise plan gate on assigning a custom role, for a deployment that composes
 * one.
 */
export abstract class ApiCustomRolePlanGatePort {
  /** Throws when the organization's plan may not assign a custom role. */
  abstract assertCustomRolesAllowed(input: {
    organizationId: string;
    members: readonly Readonly<{ role: string }>[];
  }): Promise<void>;
}

/** Everything the role and team surfaces are composed from. */
export type RoleFeatureCollaborators = Readonly<{
  prisma: PrismaClient;
  authz: AuthzService;
  /**
   * The grant ledger custom-role bindings are written through. The SAME ledger the AuthZ
   * service reads decisions from: a binding written to one and read from another is a
   * role that appears to have been granted and grants nothing.
   */
  grants: AuthzGrantsService;
  /** The Enterprise plan gate, where the deployment composed one. */
  customRolePlan?: ApiCustomRolePlanGatePort;
}>;

/** The two namespaces, the `ctx.app` slices, and the service the invites read. */
export type ComposedRoleFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    role: ReturnType<typeof createRoleTrpcRouter>;
    team: ReturnType<typeof createTeamTrpcRouter>;
  };
  /** For `ctx.app.roles` — the same application both role surfaces read. */
  app: RoleApp;
  /** For `ctx.app.authzApp`. */
  authzApp: AuthzApp;
  /**
   * The role service under {@link ComposedRoleFeature.app}.
   */
  roles: RoleService;
}>;

/** Composes the role and team surfaces over this process's own graph. */
export function composeRoleFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  grants: AuthzGrantsService;
  customRolePlan?: ApiCustomRolePlanGatePort;
}): ComposedRoleFeature {
  const collaborators: RoleFeatureCollaborators = {
    prisma: options.infrastructure.prisma,
    authz: options.infrastructure.authz,
    grants: options.grants,
    ...(options.customRolePlan ? { customRolePlan: options.customRolePlan } : {}),
  };
  const logger = createLogger("langwatch:api:role");

  const bindingIds = KsuidAuthzBindingIdAdapter.create();
  const roles = PostgresRoleAdapter.create({
    database: collaborators.prisma,
    grants: collaborators.grants,
    permissions: collaborators.authz,
    newBindingId: () => bindingIds.newBindingId(),
    scope: new ApiRoleScope(collaborators.prisma),
    permission: new ApiRolePermissions(),
  }).build();

  return {
    routers: (mount) => ({
      role: createRoleTrpcRouter({ ...mount, ports: rolePorts(collaborators, logger) }),
      team: createTeamTrpcRouter({ ...mount, ports: composeTeamPorts(collaborators, logger) }),
    }),
    app: RoleApp.create({
      roles,
      permissions: collaborators.authz,
      authzGrants: collaborators.grants,
    }),
    authzApp: AuthzApp.create({ permissions: collaborators.authz }),
    roles,
  };
}

/**
 * The role and team surfaces on a process that composed no grant ledger.
 */
export function refusingRoleFeature(): ComposedRoleFeature {
  const refuse = (): never => {
    throw new ApiRoleUnavailableError("The role surface");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    routers: (mount) => ({
      role: createRoleTrpcRouter({
        ...mount,
        ports: {
          probeOrganizationPermission: refuse,
          assertCustomRolePlan: refuse,
          customRolePermission: authzPermissionSchema,
        } as RoleTrpcPorts,
      }),
      team: createTeamTrpcRouter({ ...mount, ports: refuseEvery<TeamTrpcPorts>() }),
    }),
    app: refuseEvery<RoleApp>(),
    authzApp: refuseEvery<AuthzApp>(),
    roles: refuseEvery<RoleService>(),
  };
}

/** The three answers the role surface needs from the deployment. */
function rolePorts(options: RoleFeatureCollaborators, logger: Pick<Logger, "warn">): RoleTrpcPorts {
  return {
    probeOrganizationPermission: (ctx, organizationId, permission) =>
      options.authz.hasPermission({
        userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
        permission,
        organizationId,
      }),
    assertCustomRolePlan: async (_ctx, input) => {
      const gate = options.customRolePlan;
      if (!gate) {
        logger.warn(
          { organizationId: input.organizationId },
          "no Enterprise plan gate is composed: refusing a custom role definition or assignment",
        );
        throw new ApiRoleUnavailableError("Custom roles");
      }
      await gate.assertCustomRolesAllowed({ organizationId: input.organizationId, members: [] });
    },
    /**
     * The permission vocabulary a custom role's entries are parsed against.
     */
    customRolePermission: authzPermissionSchema,
  };
}

/** A role capability this deployment did not compose, refused by name. */
class ApiRoleUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `${capability} is not available on this deployment`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiRoleUnavailableError";
  }
}

/**
 * The two answers the team surface needs from the deployment.
 */
function composeTeamPorts(
  options: RoleFeatureCollaborators,
  logger: Pick<Logger, "warn">,
): TeamTrpcPorts {
  return {
    probeOrganizationPermission: (ctx, organizationId, permission) =>
      options.authz.hasPermission({
        userId: (ctx as unknown as ApiTrpcPortsContext).actor().id,
        permission,
        organizationId,
      }),
    assertCustomRolesAllowed: async (_ctx, input) => {
      const gate = options.customRolePlan;
      if (!gate) {
        // Only a list that actually assigns a custom role is refused. A member
        // list carrying none never touches the Enterprise capability, and
        // refusing it would break team editing on every deployment that
        // composes no billing store.
        if (!input.members.some((member) => isCustomRole(member.role))) return;
        logger.warn(
          { organizationId: input.organizationId },
          "no Enterprise plan gate is composed: refusing a member list that assigns a custom role",
        );
        throw new ApiRoleUnavailableError("Custom role assignment");
      }
      await gate.assertCustomRolesAllowed({
        organizationId: input.organizationId,
        members: input.members,
      });
    },
  };
}

/**
 * Whether a member's role names a CUSTOM role rather than one of the built-in team roles.
 */
const BUILT_IN_TEAM_ROLES = new Set(["ADMIN", "MEMBER", "VIEWER"]);

function isCustomRole(role: string): boolean {
  return !BUILT_IN_TEAM_ROLES.has(role);
}

/**
 * The personal-workspace fence a role binding is refused at, over this process's own
 * connection.
 */
class ApiRoleScope extends RoleScopePort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async assertNoPersonalTeamScope(input: {
    scopes: Array<{ scopeType: RoleBindingScopeType; scopeId: string }>;
  }): Promise<void> {
    await assertNoPersonalTeamScope({ client: this.prisma, scopes: input.scopes });
  }
}

/**
 * ADR-021's scope fence, read off the AuthZ registry rather than a hand-kept set. The
 * registry records which tiers each resource is grantable at, so it cannot fall behind a
 * resource somebody added; the set it replaces could and did.
 */
class ApiRolePermissions extends RolePermissionPort {
  isOrganizationExclusive(permission: string): boolean {
    return !bindingScopeCanGrantPermission({ scopeType: "TEAM", permission });
  }

  organizationExclusiveScopeError(input: {
    permission: string;
    scopeType: RoleBindingScopeType;
  }): Error {
    return new OrgExclusivePermissionScopeError(input.permission, input.scopeType);
  }
}

/**
 * An organization-exclusive permission was bound at TEAM or PROJECT scope.
 */
class OrgExclusivePermissionScopeError extends HandledError {
  declare readonly code: "org_exclusive_permission_scope";

  constructor(permission: string, scopeType: string) {
    super(
      "org_exclusive_permission_scope",
      "That permission only takes effect at organization scope",
      { httpStatus: 422, meta: { permission, scopeType } },
    );
    this.name = "OrgExclusivePermissionScopeError";
  }
}
