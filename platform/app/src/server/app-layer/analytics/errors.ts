/**
 * Analytics-specific error types (ADR-034 Phase 3 app-layer module).
 *
 * Kept minimal — the read-path overwhelmingly bubbles ClickHouse client
 * errors as-is. A dedicated type lets the orchestration service distinguish
 * "the routed table came back empty for an unsupported shape" from a real
 * CH failure, without leaking the legacy `Error` reach-arounds.
 */

export class AnalyticsClientUnavailableError extends Error {
  constructor(public readonly tenantId: string) {
    super(`ClickHouse client not available for tenant ${tenantId}`);
    this.name = "AnalyticsClientUnavailableError";
  }
}
