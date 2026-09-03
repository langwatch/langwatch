import type { OrganizationService as OrganizationServiceContract } from "@langwatch/organization-contract";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  GroupIdentityPort,
  PersonalWorkspaceDiagnosticsPort,
  PersonalWorkspaceIdentityPort,
  TeamIdentityPort,
  OrganizationSettingsSecretPort,
} from "../ports/organization.port";
import { PrismaGroupRepository } from "../repositories/prisma/prisma.group.repository";
import { PrismaOrganizationRepository } from "../repositories/prisma/prisma.organization.repository";
import { PrismaTeamRepository } from "../repositories/prisma/prisma.team.repository";
import { OrganizationService } from "../services/organization.service";

export interface PostgresOrganizationAdapterOptions {
  /**
   * The composition root's own guarded client, typed.
   *
   * It used to arrive as `object` and be cast back to a `PrismaClient` inside
   * each of the three repositories below, which let a caller hand in something
   * that was not a client at all and find out on the first query. Every
   * process that composes this adapter already holds the typed client.
   */
  database: PrismaClient;
  identities: PersonalWorkspaceIdentityPort;
  teamIdentities: TeamIdentityPort;
  groupIdentities: GroupIdentityPort;
  authz: AuthzService;
  grants: AuthzGrantsService;
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
      repository: PrismaOrganizationRepository.create(
        this.options.database,
        this.options.settingsSecrets,
      ),
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
