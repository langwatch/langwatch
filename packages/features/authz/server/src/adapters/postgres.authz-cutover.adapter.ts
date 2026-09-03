import type { MigrationTenantStatus } from "@langwatch/authz-contract";
import { AUTHZ_ENGINE_MIGRATION_NAME } from "../migrations/legacy-import.authz-grant.migration";
import { PerOrganizationCachedGateStore } from "../stores/memory/memory.per-organization-cached-gate.store";

export { AUTHZ_ENGINE_MIGRATION_NAME };

export const ENGINE_GATE_CACHE_TTL_MS = 60_000;

const ON_ENGINE_STATUSES: readonly MigrationTenantStatus[] = ["finalized"];

export type AuthzCutoverDatabase = {
  systemMigrationTenantState: {
    findUnique(args: {
      where: {
        migrationName_tenantId: {
          migrationName: string;
          tenantId: string;
        };
      };
      select: { status: true; occurredAt?: true };
    }): Promise<{ status: string; occurredAt?: Date } | null>;
  };
};

export type AuthzCutoverReadFailure = {
  organizationId: string;
  error: unknown;
  ttlMs: number;
};

/** Injectable reporting capability; no module import mutates a reporter. */
export abstract class AuthzCutoverFailureReporter {
  abstract report(failure: AuthzCutoverReadFailure): void;
}

export type PostgresAuthzCutoverAdapterOptions = {
  database: AuthzCutoverDatabase;
  reporter: AuthzCutoverFailureReporter;
  cache?: PerOrganizationCachedGateStore;
};

/**
 * One cached per-organization fork for both AuthZ reads and writes.
 * `readUncached` raises so revocation callers can fail toward writing both
 * heads; `isOn` reports and falls back to legacy for ordinary checks.
 */
export class PostgresAuthzCutoverAdapter {
  private readonly cache: PerOrganizationCachedGateStore;

  static create(options: PostgresAuthzCutoverAdapterOptions): PostgresAuthzCutoverAdapter {
    return new PostgresAuthzCutoverAdapter(options);
  }

  private constructor(private readonly options: PostgresAuthzCutoverAdapterOptions) {
    this.cache =
      options.cache ??
      PerOrganizationCachedGateStore.create({
        name: "authz-engine-gate",
        ttlMs: ENGINE_GATE_CACHE_TTL_MS,
      });
  }

  async readUncached({ organizationId }: { organizationId: string }): Promise<boolean> {
    const record = await this.options.database.systemMigrationTenantState.findUnique({
      where: {
        migrationName_tenantId: {
          migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
          tenantId: organizationId,
        },
      },
      select: { status: true },
    });
    return record !== null && (ON_ENGINE_STATUSES as readonly string[]).includes(record.status);
  }

  async query({ organizationId }: { organizationId: string }): Promise<boolean> {
    try {
      return await this.readUncached({ organizationId });
    } catch (error) {
      this.options.reporter.report({
        organizationId,
        error,
        ttlMs: ENGINE_GATE_CACHE_TTL_MS,
      });
      return false;
    }
  }

  async isOn({ organizationId }: { organizationId: string }): Promise<boolean> {
    return this.cache.get({
      organizationId,
      read: () => this.query({ organizationId }),
    });
  }

  async tryGetFinalizedAt({ organizationId }: { organizationId: string }): Promise<Date | null> {
    try {
      const record = await this.options.database.systemMigrationTenantState.findUnique({
        where: {
          migrationName_tenantId: {
            migrationName: AUTHZ_ENGINE_MIGRATION_NAME,
            tenantId: organizationId,
          },
        },
        select: { status: true, occurredAt: true },
      });
      return record && (ON_ENGINE_STATUSES as readonly string[]).includes(record.status)
        ? (record.occurredAt ?? null)
        : null;
    } catch (error) {
      this.options.reporter.report({
        organizationId,
        error,
        ttlMs: ENGINE_GATE_CACHE_TTL_MS,
      });
      return null;
    }
  }

  invalidate({ organizationId }: { organizationId: string }): void {
    this.cache.invalidate({ organizationId });
  }

  resetForTesting(): void {
    this.cache.resetForTesting();
  }
}
