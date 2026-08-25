import { createLogger } from "@langwatch/observability";
import type { OpsExplainClickHouseRepository } from "~/server/app-layer/ops/repositories/ops-explain.clickhouse.repository";
import { CLICKHOUSE_GUARDRAILS, consumeMissingOpsUrlWarning } from "./explain-core";

const logger = createLogger("langwatch:ops:clickhouse:explain");

export type OpsExplainOutcome =
  /** `CLICKHOUSE_OPS_URL` is unset and the caller is in production —
   *  refusing to fall back to the default-user client. */
  | { status: "not_configured_in_production" }
  /** Neither the ops user nor the shared client is configured. */
  | { status: "unavailable" }
  | { status: "ok"; rows: unknown[] }
  | { status: "error"; message: string };

/**
 * The decision-making behind the operator-only EXPLAIN endpoint: which
 * client to run against, whether the fallback is acceptable given the
 * environment, and the audit trail of what ran. The route keeps the HTTP
 * shape (status codes, JSON envelopes); this is everything about whether
 * and how the query reaches ClickHouse.
 */
export class OpsExplainService {
  constructor(private readonly repository: OpsExplainClickHouseRepository) {}

  async explain({
    wrappedQuery,
    type,
    isProduction,
    auditFields,
  }: {
    wrappedQuery: string;
    type: string;
    isProduction: boolean;
    /** Redacted request shape for the audit log — never the raw query. */
    auditFields: Record<string, unknown>;
  }): Promise<OpsExplainOutcome> {
    const resolved = this.repository.resolveClient();
    if (!resolved) return { status: "unavailable" };
    const { client, usingFallback } = resolved;

    if (usingFallback) {
      if (isProduction) {
        logger.error(
          "CLICKHOUSE_OPS_URL is not set in production — refusing to fall back to the default-user client. " +
            "Provision a langwatch_ops ClickHouse user with a readonly=1 profile " +
            "and no SOURCES grant, then set CLICKHOUSE_OPS_URL to it.",
        );
        return { status: "not_configured_in_production" };
      }
      if (consumeMissingOpsUrlWarning()) {
        logger.warn(
          "CLICKHOUSE_OPS_URL is not set — /ops/clickhouse/explain is falling back to the default-user client. " +
            "Provision a langwatch_ops ClickHouse user with a readonly=1 profile " +
            "and no SOURCES grant, then set CLICKHOUSE_OPS_URL to it to remove this fallback.",
        );
      }
    }

    logger.info({ type, usingFallback, ...auditFields }, "ops explain");

    try {
      const rows = await this.repository.runExplain({
        client,
        wrappedQuery,
        guardrails: usingFallback ? CLICKHOUSE_GUARDRAILS : undefined,
      });
      return { status: "ok", rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, "ops explain failed");
      return { status: "error", message };
    }
  }
}
