import type {
  AuthzGrantsService,
  AuthzService,
} from "@langwatch/authz-contract";
import type { RoleService } from "@langwatch/role-contract";
import { PostgresRoleAdapter } from "@langwatch/role-server";
import { generate } from "@langwatch/ksuid";
import type { PrismaClient } from "~/generated/prisma/client";
import { isOrgExclusivePermission } from "~/server/api/rbac";
import { OrgExclusivePermissionScopeError } from "~/server/role-bindings/errors";
import { assertNoPersonalTeamScope } from "~/server/role-bindings/personal-team-scope";
import { KSUID_RESOURCES } from "~/utils/constants";

export class AppRoleRuntime {
  private constructor(
    private readonly database: PrismaClient,
    private readonly grants: AuthzGrantsService,
    private readonly permissions: AuthzService,
  ) {}

  static create(options: {
    database: PrismaClient;
    grants: AuthzGrantsService;
    permissions: AuthzService;
  }): AppRoleRuntime {
    return new AppRoleRuntime(
      options.database,
      options.grants,
      options.permissions,
    );
  }

  build(): RoleService {
    return PostgresRoleAdapter.create({
      database: this.database,
      grants: this.grants,
      permissions: this.permissions,
      newBindingId: () =>
        generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      scope: {
        assertNoPersonalTeamScope: ({ scopes }) =>
          assertNoPersonalTeamScope({ client: this.database, scopes }),
      },
      permission: {
        isOrganizationExclusive: isOrgExclusivePermission,
        organizationExclusiveScopeError: ({ permission, scopeType }) =>
          new OrgExclusivePermissionScopeError(permission, scopeType),
      },
    }).build();
  }
}
