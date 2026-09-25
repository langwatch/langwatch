/**
 * Identity's system-migration legs as the one-shot migration pass composes them (ADR-101 §6,
 * ADR-116 §3): the user- and organization-rooted registries and the abandoned-newborn sweep.
 */
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { SystemMigration } from "@langwatch/system-migrations";

import { IdentityLedgerStore } from "../eventing/identity-ledger.store.ts";
import { composeIdentityGuards } from "../eventing/user-identity.pipeline.ts";
import { identityMigrationRepositories } from "../repositories/identity-repositories.registry.ts";
import type { IdentityMigrationRepositories } from "../repositories/identity.repositories.ts";
import { CryptoIdentifierIdentityService } from "../services/crypto-identifier-identity.service.ts";
import { IdentityBackfillPlanService } from "../services/identity-backfill-plan.service.ts";
import { IdentityBackfillService } from "../services/identity-backfill.service.ts";
import { IdentityNewbornReconciliationService } from "../services/identity-newborn-reconciliation.service.ts";
import { IdentitySecretCarryService } from "../services/identity-secret-carry.service.ts";
import { IdentityService } from "../services/identity.service.ts";
import { SsoDomainOwnershipBackfillService } from "../services/sso-domain-ownership-backfill.service.ts";
import { IdentityIdentifierBackfillMigrationService } from "../services/system-migration-identity-identifier-backfill.service.ts";
import { IdentitySecretHealMigrationService } from "../services/system-migration-identity-secret-heal.service.ts";
import { SsoDomainOwnershipMigrationService } from "../services/system-migration-sso-domain-ownership.service.ts";
import type { IdentityEventing } from "./identity.members.ts";

export type IdentityMigrationsOptions = {
  /** The composition root's own typed client, handed to the registry and nowhere else. */
  database: ProcessMembers["prisma"];
  /** The event stack the adoption and erase commands stage through. */
  eventing: IdentityEventing;
};

/** The identity service over the SAME address lock the guards claim through (ADR-116 §6). */
function identityOver(options: {
  repositories: IdentityMigrationRepositories;
  eventing: IdentityEventing;
}): IdentityService {
  const { identityGuards } = composeIdentityGuards(options.repositories);
  return IdentityService.create(
    identityGuards,
    IdentityLedgerStore.create({
      projectionStore: options.repositories.identityProjection,
      eventing: options.eventing,
    }),
  );
}

/** The USER-rooted registry, in main's order: the D01 identifier backfill, then its heal. */
export class IdentityUserMigrations {
  static create(options: IdentityMigrationsOptions): IdentityUserMigrations {
    return new IdentityUserMigrations(options);
  }

  private constructor(private readonly options: IdentityMigrationsOptions) {}

  build(): readonly SystemMigration[] {
    const repositories = identityMigrationRepositories(this.options.database);
    const secrets = IdentitySecretCarryService.create(repositories.secretCarry);
    const backfill = IdentityBackfillService.create({
      reads: repositories.backfill,
      users: repositories.users,
      identity: identityOver({ repositories, eventing: this.options.eventing }),
      secrets,
      plan: IdentityBackfillPlanService.create(CryptoIdentifierIdentityService.create()),
    });
    return [
      IdentityIdentifierBackfillMigrationService.create(backfill),
      IdentitySecretHealMigrationService.create(secrets),
    ];
  }
}

/** The abandoned-newborn sweep, composed wherever the migration pass runs, as a leg of it. */
export class IdentityNewbornSweep {
  static create(options: IdentityMigrationsOptions): IdentityNewbornSweep {
    return new IdentityNewbornSweep(options);
  }

  private constructor(private readonly options: IdentityMigrationsOptions) {}

  build(): IdentityNewbornReconciliationService {
    const repositories = identityMigrationRepositories(this.options.database);
    return IdentityNewbornReconciliationService.create({
      newborns: repositories.newborn,
      identity: identityOver({ repositories, eventing: this.options.eventing }),
      reservations: repositories.reservations,
    });
  }
}

/** The ORGANIZATION-rooted registry, beside the user-rooted one. */
export class IdentityOrganizationMigrations {
  static create(
    options: Pick<IdentityMigrationsOptions, "database">,
  ): IdentityOrganizationMigrations {
    return new IdentityOrganizationMigrations(options);
  }

  private constructor(private readonly options: Pick<IdentityMigrationsOptions, "database">) {}

  build(): readonly SystemMigration[] {
    const repositories = identityMigrationRepositories(this.options.database);
    return [
      SsoDomainOwnershipMigrationService.create(
        SsoDomainOwnershipBackfillService.create(repositories.ssoDomainOwnership),
      ),
    ];
  }
}
