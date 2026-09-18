import type { MigrationTenantStatus } from "@langwatch/authz-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../../migrations/legacy-import.authz-grant.migration.ts";
import { AuthzCutoverRepository, type AuthzCutoverRow } from "../authz-cutover.repository.ts";

export type AuthzCutoverDatabase = {
  systemMigrationTenantState: {
    findUnique(args: {
      where: {
        migrationName_tenantId: {
          migrationName: string;
          tenantId: string;
        };
      };
      select: { status: true; occurredAt: true };
    }): Promise<{ status: string; occurredAt?: Date | null } | null>;
  };
};

/** The tenant migration-state row, read by organization. */
export class PrismaAuthzCutoverRepository extends AuthzCutoverRepository {
  static create(options: { database: AuthzCutoverDatabase }): PrismaAuthzCutoverRepository {
    return new PrismaAuthzCutoverRepository(options.database);
  }

  private constructor(private readonly database: AuthzCutoverDatabase) {
    super();
  }

  async findCutover({ organizationId }: { organizationId: string }): Promise<AuthzCutoverRow | null> {
    const record = await this.database.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
          tenantId: organizationId,
        },
      },
      select: { status: true, occurredAt: true },
    });
    if (!record) return null;
    return { status: record.status as MigrationTenantStatus, occurredAt: record.occurredAt ?? null };
  }
}
