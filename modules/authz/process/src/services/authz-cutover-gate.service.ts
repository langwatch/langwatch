import type { MigrationTenantStatus } from "@langwatch/authz-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";
import { Counter } from "prom-client";

import type { AuthzCutoverRepository } from "../repositories/authz-cutover.repository.ts";
import { PerOrganizationCachedGateStore } from "../stores/memory/memory.per-organization-cached-gate.store.ts";

export const ENGINE_GATE_CACHE_TTL_MS = 60_000;

/** The metric name is an external interface; dashboards and alerts read it. */
export const authzEngineGateReadFailuresTotal = new Counter({
  name: "authz_engine_gate_read_failures_total",
  help: "Failed reads of an organization's AuthZ migration state; the organization stays on the legacy path for the cache TTL.",
});

const ON_ENGINE_STATUSES: readonly MigrationTenantStatus[] = ["finalized"];

export type AuthzCutoverGateOptions = {
  repository: AuthzCutoverRepository;
  logger?: Logger;
  cache?: PerOrganizationCachedGateStore;
};

/**
 * One cached per-organization fork for both AuthZ reads and writes.
 * `readUncached` raises so revocation callers can fail toward writing both
 * heads; `isOn` reports and falls back to legacy for ordinary checks.
 */
export class AuthzCutoverGateService {
  private readonly cache: PerOrganizationCachedGateStore;
  private readonly logger: Logger;

  static create(options: AuthzCutoverGateOptions): AuthzCutoverGateService {
    return new AuthzCutoverGateService(options);
  }

  private constructor(private readonly options: AuthzCutoverGateOptions) {
    this.logger = options.logger ?? createLogger("langwatch:authz:engine-gate");
    this.cache =
      options.cache ??
      PerOrganizationCachedGateStore.create({
        name: "authz-engine-gate",
        ttlMs: ENGINE_GATE_CACHE_TTL_MS,
      });
  }

  async readUncached({ organizationId }: { organizationId: string }): Promise<boolean> {
    const row = await this.options.repository.findCutover({ organizationId });
    return row !== null && (ON_ENGINE_STATUSES as readonly string[]).includes(row.status);
  }

  async query({ organizationId }: { organizationId: string }): Promise<boolean> {
    try {
      return await this.readUncached({ organizationId });
    } catch (error) {
      this.report({ organizationId, error });
      return false;
    }
  }

  async isOn({ organizationId }: { organizationId: string }): Promise<boolean> {
    return this.cache.get({
      organizationId,
      read: () => this.query({ organizationId }),
    });
  }

  async findFinalizedAt({ organizationId }: { organizationId: string }): Promise<Instant | null> {
    try {
      const row = await this.options.repository.findCutover({ organizationId });
      return row && (ON_ENGINE_STATUSES as readonly string[]).includes(row.status)
        ? (row.occurredAt ?? null)
        : null;
    } catch (error) {
      this.report({ organizationId, error });
      return null;
    }
  }

  invalidate({ organizationId }: { organizationId: string }): void {
    this.cache.invalidate({ organizationId });
  }

  resetForTesting(): void {
    this.cache.resetForTesting();
  }

  private report({ organizationId, error }: { organizationId: string; error: unknown }): void {
    this.logger.warn(
      { organizationId, error, ttlMs: ENGINE_GATE_CACHE_TTL_MS },
      "could not read the authz migration state; compatibility migration completion remains unknown until the cache expires",
    );
    authzEngineGateReadFailuresTotal.inc();
  }
}
