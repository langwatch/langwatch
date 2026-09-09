/**
 * The organization's custom roles and their bindings. Three things this feature
 * may not build for itself arrive here: the personal-workspace fence, the
 * Enterprise plan gate, and the identifier format a binding is written under.
 */
import { AuthzApi, type AuthzApi as AuthzApiContract } from "@langwatch/authz-contract";
import { KsuidAuthzBindingIdAdapter } from "@langwatch/authz-server";
import type { PlanProvider } from "@langwatch/entitlement-contract";
import {
  assertEnterprisePlanType,
  ENTERPRISE_FEATURE_ERRORS,
} from "@langwatch/enterprise-plan-gate";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import {
  PersonalTeamScopeService,
  PostgresPersonalTeamScopeAdapter,
} from "@langwatch/organization-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RoleBindingScopeType } from "@langwatch/role-contract";
import {
  RoleBindingIdPort,
  RoleCustomRolePlanPort,
  RoleScopePort,
  roleServer,
} from "@langwatch/role-server";
import { createApp } from "@langwatch/runtime-composition";
import { UserApi, type UserApi as UserApiContract } from "@langwatch/user-contract";

import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";
import { createRoleBindingTrpcRouter, createRoleTrpcRouter } from "./role-trpc.mount.ts";
import type { ComposedRoleFeature } from "./role.composition.types.ts";

/** The other features' applications the role surfaces read. */
export type RolePeers = Readonly<{
  permissions: AuthzApiContract;
  organizations: OrganizationApiContract;
  users: UserApiContract;
}>;

/** Installs the role surfaces over this process's own graph. */
export async function installApiRole(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: RolePeers;
  /**
   * The SAME plan provider every allowance banner reads: a capability refused
   * here and offered there would be one organization on two plans.
   */
  plans: PlanProvider;
}): Promise<ComposedRoleFeature> {
  const { prisma } = options.infrastructure;
  const { permissions, organizations, users } = options.peers;

  const runtime = await createApp({ name: "langwatch-api" })
    .withPersistence("postgres", { prisma })
    .withInfrastructure({})
    .withProvided(AuthzApi, permissions)
    .withProvided(OrganizationApi, organizations)
    .withProvided(UserApi, users)
    .withModule(roleServer, {
      infrastructure: {
        scope: new ApiRoleScope(prisma),
        plan: new ApiCustomRolePlanGate(options.plans),
        bindingIds: new ApiRoleBindingIds(),
      },
    })
    .boot({ role: "api" });

  const app = runtime.module(roleServer).provided;

  return {
    routers: (mount) => ({
      role: createRoleTrpcRouter(mount.runtime),
      roleBinding: createRoleBindingTrpcRouter(mount.runtime),
    }),
    app,
  };
}

/**
 * The personal-workspace fence a role binding is refused at, over this
 * process's own connection. A personal team holds exactly one member, its
 * owner, so nothing may be bound into it.
 */
class ApiRoleScope extends RoleScopePort {
  constructor(private readonly prisma: PrismaClient) {
    super();
  }

  async assertNoPersonalTeamScope(input: {
    scopes: { scopeType: RoleBindingScopeType; scopeId: string }[];
  }): Promise<void> {
    await PersonalTeamScopeService.create(
      PostgresPersonalTeamScopeAdapter.create({ database: this.prisma }),
    ).assertNoPersonalTeamScope({ scopes: input.scopes });
  }
}

/** The Enterprise plan gate, over the one plan provider this process resolves. */
class ApiCustomRolePlanGate extends RoleCustomRolePlanPort {
  constructor(private readonly plans: PlanProvider) {
    super();
  }

  async assertCustomRolesAllowed(input: { organizationId: string }): Promise<void> {
    const plan = await this.plans.getActivePlan({ organizationId: input.organizationId });
    assertEnterprisePlanType({
      planType: plan.type,
      errorMessage: ENTERPRISE_FEATURE_ERRORS.RBAC,
    });
  }
}

/** The identifier a newly attached binding is written under, in the ledger's own format. */
class ApiRoleBindingIds extends RoleBindingIdPort {
  #ids = KsuidAuthzBindingIdAdapter.create();

  newBindingId(): string {
    return this.#ids.newBindingId();
  }
}
