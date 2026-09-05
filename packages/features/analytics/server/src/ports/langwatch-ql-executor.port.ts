/**
 * The only LangWatchQL database seam.
 *
 * An executor runs an already-validated statement as the restricted identity —
 * never the application's administrative client, which has no tenant row
 * policy. The tenant capability is the sole query setting; the database profile
 * pins read-only and the resource ceilings, and this seam only bounds what the
 * finished result carries back.
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
 *
 * Distinct from the ceilings the settings profile pins, and the distinction is
 * the whole design: the database's ceilings decide whether the query is allowed
 * to *finish* and throw when it is not, while these decide how much of a
 * finished result is serialised into the response. Overflow here is never
 * silent — the result carries `truncated`, and the service turns that into a
 * diagnostic the caller can branch on.
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
   *
   * The real one owns a connection pool, and a process that replaces its
   * service — which the endpoint suites do several times per file — would
   * otherwise leave the previous pool's sockets open against the same server
   * for the lifetime of the process. A double that holds nothing overrides
   * this with the no-op it inherits.
   */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
