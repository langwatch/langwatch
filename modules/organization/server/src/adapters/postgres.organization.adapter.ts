import type { OrganizationService as OrganizationServiceContract } from "@langwatch/organization-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  GroupIdentityPort,
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
  OrganizationSettingsSecretPort,
} from "../ports/organization.port.ts";
import { PrismaGroupRepository } from "../repositories/prisma/prisma.group.repository.ts";
import { PrismaOrganizationRepository } from "../repositories/prisma/prisma.organization.repository.ts";
import { PrismaTeamRepository } from "../repositories/prisma/prisma.team.repository.ts";
import { OrganizationService } from "../services/organization.service.ts";

export interface PostgresOrganizationAdapterOptions {
  /** The composition root's own guarded client, typed — every process composing this adapter
   * already holds it, so it's never cast back from `object` inside the repositories. */
  database: PrismaClient;
  identities: PersonalWorkspaceIdentityPort;
  teamIdentities: TeamIdentityPort;
  groupIdentities: GroupIdentityPort;
  authz: AuthzApi;
  grants: AuthzApi;
  settingsSecrets: OrganizationSettingsSecretPort;
  diagnostics?: PersonalWorkspaceDiagnosticsPort;
}

export class PostgresOrganizationAdapter {
  private constructor(private readonly options: PostgresOrganizationAdapterOptions) {}

  static create(options: PostgresOrganizationAdapterOptions): PostgresOrganizationAdapter {
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
      settingsSecrets: this.options.settingsSecrets,
    });
  }
}
