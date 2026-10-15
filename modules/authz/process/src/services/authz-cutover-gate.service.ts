import { createLogger, type Logger } from "@langwatch/observability";
import { counter } from "@langwatch/observability/metrics";
import type { Instant } from "@langwatch/time";

import type { AuthzCutoverRepository } from "../repositories/authz-cutover.repository.ts";
import { PerOrganizationCachedGateService } from "./per-organization-cached-gate.service.ts";

export const ENGINE_GATE_CACHE_TTL_MS = 60_000;

/** The metric name is an external interface; dashboards and alerts read it. */
export const authzEngineGateReadFailuresTotal = counter({
  name: "authz_engine_gate_read_failures_total",
  description:
    "Failed reads of an organization's AuthZ migration state; the organization stays on the legacy path for the cache TTL.",
});

type AuthzCutoverGateOptions = {
  repository: AuthzCutoverRepository;
  logger?: Logger;
  cache?: PerOrganizationCachedGateService;
};

/**
 * One cached per-organization fork for both AuthZ reads and writes.
 * `readUncached` raises so revocation callers can fail toward writing both
 * heads; `isOn` reports and falls back to legacy for ordinary checks.
 */
export class AuthzCutoverGateService {
  private readonly cache: PerOrganizationCachedGateService;
  private readonly logger: Logger;

  static create(options: AuthzCutoverGateOptions): AuthzCutoverGateService {
    return new AuthzCutoverGateService(options);
  }

  private constructor(private readonly options: AuthzCutoverGateOptions) {
    this.logger = options.logger ?? createLogger("langwatch:authz:engine-gate");
    this.cache =
      options.cache ??
      PerOrganizationCachedGateService.create({
        name: "authz-engine-gate",
        ttlMs: ENGINE_GATE_CACHE_TTL_MS,
      });
  }

  async readUncached({ organizationId }: { organizationId: string }): Promise<boolean> {
    const engineSwitch = await this.options.repository.getEngineSwitch({ organizationId });
    return engineSwitch.onEngine;
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
      const engineSwitch = await this.options.repository.getEngineSwitch({ organizationId });
      return engineSwitch.onEngine ? engineSwitch.switchedAt : null;
    } catch (error) {
      this.report({ organizationId, error });
      return null;
    }
  }

  /** An operator's rollback, from ops' fact: the organization leaves the engine for good. */
  async pin({
    organizationId,
    at,
    eventId,
  }: {
    organizationId: string;
    at: Instant;
    eventId: string;
  }): Promise<void> {
    await this.options.repository.pinEngineSwitch({ organizationId, at, eventId });
    this.invalidate({ organizationId });
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
