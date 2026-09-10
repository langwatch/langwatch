import type { SpendEventRow, SpendFilters } from "@langwatch/gateway-contract";
import type { GatewaySpendState } from "../projections/gateway-spend.projection.ts";

export const SPEND_GROUP_BY_KEYS = [
  "virtual_key",
  "end_user",
  "project",
  "model",
  "provider",
  "principal",
  "request_type",
] as const;

export type SpendGroupByKey = (typeof SPEND_GROUP_BY_KEYS)[number];

export const SPEND_BUCKETS = ["none", "hour", "day"] as const;
export type SpendBucket = (typeof SPEND_BUCKETS)[number];

export interface SpendEventsPageCursor {
  occurredAtMs: number;
  gatewayRequestId: string;
}

export interface SpendSummaryRow {
  /**
   * The first grouping dimension's value, kept first so a consumer written against the single-dimension surface keeps reading what it always did; `group` is what tells two dimensions sharing one flat key apart.
   */
  key: string;
  /** Every grouping dimension by name, e.g. `{ model: "gpt-5-mini" }`. */
  group: Record<string, string>;
  /** Start of the time bucket in the requested zone, null when unbucketed. */
  bucketStart: string | null;
  eventCount: number;
  settledCount: number;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  costNanoUsd: number;
  costUsd: string;
}

export abstract class GatewaySpendEvents {
  abstract upsertFromFold(
    entries: Array<{
      tenantId: string;
      gatewayRequestId: string;
      state: GatewaySpendState;
    }>,
  ): Promise<void>;

  abstract tryReadForFold(input: {
    tenantId: string;
    gatewayRequestId: string;
  }): Promise<GatewaySpendState | null>;

  abstract readSpendEventsPage(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    filters?: SpendFilters;
    cursor?: SpendEventsPageCursor;
    limit?: number;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: SpendEventsPageCursor | null }>;

  abstract walkSpendEvents(input: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: string | null }>;

  abstract readSpendSummaries(input: {
    tenantIds: string[];
    groupBy: SpendGroupByKey[];
    bucket?: SpendBucket;
    timezone?: string;
    fromMs: number;
    toMs: number;
    cursor?: string | null;
    limit?: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendSummaryRow[]; nextCursor: string | null }>;

  abstract readEndUserSpend(input: {
    tenantIds: string[];
    endUserId: string;
    fromMs: number;
    toMs: number;
    virtualKeyId?: string;
  }): Promise<{
    spendUsd: string;
    spendNanoUsd: number;
    requestCount: number;
    tokensInput: number;
    tokensOutput: number;
    tokensCacheRead: number;
    tokensCacheWrite: number;
    tokensReasoning: number;
  }>;
}
