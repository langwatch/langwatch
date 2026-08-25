import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { RoleService as RoleServiceContract } from "@langwatch/role-contract";
import { RolePermissionPort, RoleScopePort } from "../ports/role.port";
import { PrismaRoleRepository } from "../repositories/prisma/prisma.role.repository";
import { RoleService, type RoleServiceDependencies } from "../services/role.service";

export interface PostgresRoleAdapterOptions {
  database: object;
  grants: AuthzGrantsService;
  permissions: AuthzService;
  newBindingId: () => string;
  scope: RoleScopePort;
  permission: RolePermissionPort;
}

export class PostgresRoleAdapter {
  private constructor(private readonly options: PostgresRoleAdapterOptions) {}

  static create(options: PostgresRoleAdapterOptions): PostgresRoleAdapter {
    return new PostgresRoleAdapter(options);
  }

  build(): RoleServiceContract {
    const dependencies: RoleServiceDependencies = {
      repository: PrismaRoleRepository.create({
        database: this.options.database,
        writer: this.options.grants,
        access: this.options.permissions,
        newBindingId: this.options.newBindingId,
      }),
      scope: this.options.scope,
      permission: this.options.permission,
    };
    return RoleService.create(dependencies);
  }
}
