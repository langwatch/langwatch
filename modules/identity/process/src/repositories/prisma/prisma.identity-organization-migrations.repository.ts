import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { SystemMigration } from "@langwatch/system-migrations";

import { SsoDomainOwnershipBackfillService } from "../../services/sso-domain-ownership-backfill.service.ts";
import { SsoDomainOwnershipMigrationService } from "../../services/system-migration-sso-domain-ownership.service.ts";
import { PrismaSsoDomainOwnershipRepository } from "./prisma.sso-domain-ownership.repository.ts";

export type PostgresIdentityOrganizationMigrationsOptions = {
  /** The composition root's own typed client, handed down with no cast. */
  database: PrismaClient;
};

/** Identity's ORGANIZATION-rooted migration registry, beside the user-rooted one. */
export class PostgresIdentityOrganizationMigrationsAdapter {
  static create(
    options: PostgresIdentityOrganizationMigrationsOptions,
  ): PostgresIdentityOrganizationMigrationsAdapter {
    return new PostgresIdentityOrganizationMigrationsAdapter(options);
  }

  private constructor(private readonly options: PostgresIdentityOrganizationMigrationsOptions) {}

  build(): readonly SystemMigration[] {
    return [
      SsoDomainOwnershipMigrationService.create(
        SsoDomainOwnershipBackfillService.create(
          PrismaSsoDomainOwnershipRepository.create(this.options.database),
        ),
      ),
    ];
  }
}
