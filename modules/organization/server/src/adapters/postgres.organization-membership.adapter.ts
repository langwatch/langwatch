import type { AuthzApi } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  OrganizationGrantCachePort,
  OrganizationPromptSeedPort,
  OrganizationSeatLicensePort,
  OrganizationSessionRevocationPort,
} from "../ports/organization-membership.port.ts";
import { PrismaOrganizationMembershipRepository } from "../repositories/prisma/prisma.organization-membership.repository.ts";
import { OrganizationMembershipService } from "../services/organization-membership.service.ts";

export interface PostgresOrganizationMembershipAdapterOptions {
  database: PrismaClient;
  /** The grant ledger every membership write states its access on. */
  grants: AuthzApi;
  prompts: OrganizationPromptSeedPort;
  seats: OrganizationSeatLicensePort;
  sessions: OrganizationSessionRevocationPort;
  grantCache: OrganizationGrantCachePort;
}

/**
 * The membership half over Postgres — one place a process says "these rows, that ledger, those
 * four ports" rather than assembling a repository and a service by hand.
 */
export class PostgresOrganizationMembershipAdapter {
  static create(
    options: PostgresOrganizationMembershipAdapterOptions,
  ): PostgresOrganizationMembershipAdapter {
    return new PostgresOrganizationMembershipAdapter(options);
  }

  private constructor(private readonly options: PostgresOrganizationMembershipAdapterOptions) {}

  build(): OrganizationMembershipService {
    return OrganizationMembershipService.create({
      repository: PrismaOrganizationMembershipRepository.create({
        database: this.options.database,
        grants: this.options.grants,
      }),
      prompts: this.options.prompts,
      seats: this.options.seats,
      sessions: this.options.sessions,
      grantCache: this.options.grantCache,
    });
  }
}
