/**
 * The only LangWatchQL database seam. An executor runs an already-validated statement as the
 * restricted identity — never the application's administrative client, which has no tenant row
 * policy.
 */
import type { LangWatchQLColumn, LangWatchQLStatistics } from "@langwatch/analytics-contract";

/** A submitted, already-validated query and the ceilings on what it returns. */
export interface LangWatchQLExecutionRequest {
  /** Exactly as the caller wrote it. Never rewritten. */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** The caller's tenant capability, sent as the one changeable setting. */
  readonly tenantCapability: string;
  readonly limits: LangWatchQLResultLimits;
}

/**
 * How much of a result reaches the caller.
 */
export interface LangWatchQLResultLimits {
  /** Most rows a response may carry. */
  readonly maxRows: number;
  /** Approximate JSON byte budget for those rows. */
  readonly maxResultBytes: number;
}

/** A finished execution, already bounded by the result ceilings. */
export interface LangWatchQLExecutionResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: LangWatchQLStatistics;
  /** Whether a ceiling cut the result short. Never silent. */
  readonly truncated: boolean;
}

/** How to reach the LangWatchQL schema as the restricted identity. */
export interface LangWatchQLConnection {
  /** ClickHouse HTTP endpoint. */
  readonly url: string;
  /** The restricted identity — never an administrative account. */
  readonly username: string;
  readonly password: string;
  /** Database an unqualified table name resolves to, i.e. the LangWatchQL one. */
  readonly database: string;
  /** Custom setting carrying the tenant capability, per the settings profile. */
  readonly tenantSetting: string;
}

/** The narrow seam the LangWatchQL service depends on. */
export abstract class LangWatchQLExecutorPort {
  abstract execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult>;

  /**
   * Releases whatever transport this executor holds.
   */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
