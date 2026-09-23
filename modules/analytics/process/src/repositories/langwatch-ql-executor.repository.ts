/**
 * The only LangWatchQL database seam. An executor runs an already-validated statement as the
 * restricted identity — never the application's administrative client, which has no tenant row
 * policy.
 */
import type { LangWatchQLColumn, LangWatchQLStatistics } from "@langwatch/analytics-contract";

/** A submitted, already-validated query as it reaches the transport. */
export interface LangWatchQLExecutionRequest {
  /** The caller's statement, save for the default `LIMIT` appended when it names none. */
  readonly sql: string;
  /** Values for the parameters the SQL declares. */
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** The caller's tenant capability, sent as the one changeable setting. */
  readonly tenantCapability: string;
}

/** The two bounds the service applies to a result; neither is enforced by the executor. */
export interface LangWatchQLResultLimits {
  /** The row cap — the `LIMIT` appended to a statement naming none. */
  readonly maxRows: number;
  /** The hard JSON byte ceiling; a result past it is refused, never cut. */
  readonly maxResultBytes: number;
}

/** A finished execution: every row the database returned. The service bounds them. */
export interface LangWatchQLExecutionResult {
  readonly columns: readonly LangWatchQLColumn[];
  readonly rows: readonly Record<string, unknown>[];
  readonly statistics: LangWatchQLStatistics;
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
export abstract class LangWatchQLExecutor {
  abstract execute(request: LangWatchQLExecutionRequest): Promise<LangWatchQLExecutionResult>;

  /**
   * Releases whatever transport this executor holds.
   */
  close(): Promise<void> {
    return Promise.resolve();
  }
}
