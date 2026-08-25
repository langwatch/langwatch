import type { OrganizationService as OrganizationServiceContract } from "@langwatch/organization-contract";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type {
  GroupIdentityPort,
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
} from "../ports/organization.port";
import { PrismaGroupRepository } from "../repositories/prisma/prisma.group.repository";
import { PrismaOrganizationRepository } from "../repositories/prisma/prisma.organization.repository";
import { PrismaTeamRepository } from "../repositories/prisma/prisma.team.repository";
import { OrganizationService } from "../services/organization.service";

export interface PostgresOrganizationAdapterOptions {
  database: object;
  identities: PersonalWorkspaceIdentityPort;
  teamIdentities: TeamIdentityPort;
  groupIdentities: GroupIdentityPort;
  authz: AuthzService;
  grants: AuthzGrantsService;
  diagnostics?: PersonalWorkspaceDiagnosticsPort;
}

export class PostgresOrganizationAdapter {
  private constructor(private readonly options: PostgresOrganizationAdapterOptions) {}

  static create(
    options: PostgresOrganizationAdapterOptions,
  ): PostgresOrganizationAdapter {
    return new PostgresOrganizationAdapter(options);
  }

  build(): OrganizationServiceContract {
    return OrganizationService.create({
      repository: PrismaOrganizationRepository.create(this.options.database),
      teams: PrismaTeamRepository.create(this.options.database),
      groups: PrismaGroupRepository.create(this.options.database),
      identities: this.options.identities,
      teamIdentities: this.options.teamIdentities,
      groupIdentities: this.options.groupIdentities,
      authz: this.options.authz,
      grants: this.options.grants,
      diagnostics: this.options.diagnostics,
    });
  }
}
