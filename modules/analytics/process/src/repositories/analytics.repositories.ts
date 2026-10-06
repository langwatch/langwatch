import type { LwqlProvisioningDatabase } from "../tasks/lwql-provision.task.ts";
import type { AnalyticsEvaluationRepository } from "./analytics-persistence.repository.ts";
import type { AnalyticsRateLimitRepository } from "./analytics-rate-limit.repository.ts";
import type { AnalyticsRecencyRepository } from "./analytics-recency.repository.ts";
import type { AnalyticsSessionsRepository } from "./analytics-sessions.repository.ts";
import type { AnalyticsRepository } from "./analytics.repository.ts";
import type { LangWatchQLAppFunctionStoreRepository } from "./langwatch-ql-app-function-store.repository.ts";
import type { ClickHouseAdminStatements } from "./langwatch-ql-provisioning.repository.ts";

/**
 * Whether this deployment offers LangWatchQL (ADR-159): the credential-free ClickHouse target and
 * identity, plus what self-provisioning reads, built from the stores (Alex, 2026-09-28).
 */
export type LangWatchQlSupply = Readonly<{
  /** The stores' untenanted ClickHouse seam and credential-free target (ADR-159). */
  admin: Readonly<
    | { configured: false }
    | {
        configured: true;
        target: Readonly<{ url: string; database: string }>;
        statements: ClickHouseAdminStatements;
      }
  >;
  /** The PostgreSQL endpoint the named collection dials, without credentials. */
  postgres: Readonly<
    | { configured: false }
    | {
        configured: true;
        host: string;
        port: number;
        database: string;
        schema: string;
        connectionLimit?: number;
      }
  >;
  database: () => LwqlProvisioningDatabase;
}>;

/** What the analytics module reads and counts, chosen once at boot. */
export interface AnalyticsRepositories {
  /** A raw tenant session, for the ClickHouse reads not yet behind a named repository. */
  readonly sessions: AnalyticsSessionsRepository;
  /** The timeseries and legacy reads over the analytics tables. */
  readonly analytics: AnalyticsRepository;
  /** The evaluation tables, opened with the retention peer's default, which no registry reads. */
  readonly evaluations: Readonly<{
    open(input: { defaultRetentionDays: () => number }): AnalyticsEvaluationRepository;
  }>;
  /** Where the server would keep the app functions, for the checkup's provisioning probe. */
  readonly appFunctionStore: LangWatchQLAppFunctionStoreRepository;
  /** The newest slim-table row per source, which the graph-alert heartbeat reads. */
  readonly recency: AnalyticsRecencyRepository;
  /** The per-project window every LangWatchQL execution is counted against. */
  readonly rateLimits: AnalyticsRateLimitRepository;
  readonly langWatchQl: LangWatchQlSupply;
}
