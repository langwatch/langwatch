import type { ClickHouseServerHealth } from "@langwatch/ops-contract";

/** One group of failed statements as the query log answers it; `source` is not yet checked. */
export type ClickHouseQueryErrorRow = Readonly<{
  queryShapeId: string;
  source: string;
  code: number;
  codeName: string;
  count: number;
  p95Ms: number;
  maxMemoryBytes: number;
  rowsRead: number;
  projectIds: readonly string[];
  lastAt: number;
}>;

/**
 * The shared ClickHouse's own system tables: its query log and its health. `cluster` names the
 * replicas to read together; absent reads the endpoint's own node. Every read resolves or throws.
 */
export abstract class ClickHouseServerRepository {
  /** Failed statements of the app's database in `[sinceMs, untilMs)`; empty without a query log. */
  abstract findQueryErrors(input: {
    sinceMs: number;
    untilMs: number;
    code?: number | undefined;
    source?: string | undefined;
    cluster?: string | undefined;
  }): Promise<ClickHouseQueryErrorRow[]>;
  abstract findHealth(input: { cluster?: string | undefined }): Promise<ClickHouseServerHealth>;
}
