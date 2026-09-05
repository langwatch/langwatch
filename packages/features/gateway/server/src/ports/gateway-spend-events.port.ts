import type { SpendEventStatus } from "../adapters/gateway-spend-filters.adapter";
import type { GatewaySpendState } from "../projections/gateway-spend.projection";

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

/** A metadata predicate: the caller's own key, and the values that match. */
export interface SpendMetadataFilter {
  key: string;
  /** Any of these matches. Repeating a key in the query widens it. */
  values: string[];
}

export interface SpendFilters {
  virtualKeyIds?: string[];
  endUserIds?: string[];
  principalUserIds?: string[];
  models?: string[];
  providerKeys?: string[];
  requestTypes?: string[];
  labels?: string[];
  metadata?: SpendMetadataFilter[];
  status?: string;
}

export type SpendEventRow = {
  tenantId: string;
  gatewayRequestId: string;
  organizationId: string;
  /** Not carried by the command pipeline; kept for response-shape
   *  stability, always empty. */
  teamId: string;
  virtualKeyId: string;
  principalUserId: string;
  endUserId: string;
  traceId: string;
  model: string;
  providerKey: string;
  requestType: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCacheRead: number;
  tokensCacheWrite: number;
  tokensReasoning: number;
  /** Integer nano-USD, the authoritative figure. */
  costNanoUsd: number;
  /** Decimal USD string derived from costNanoUsd, up to 9 fractional digits. */
  costUsd: string;
  rateVersion: string;
  status: SpendEventStatus;
  errorClass: string;
  httpStatus: number;
  needsReconciliation: boolean;
  /** Why settlement fired, set only on settled rows. */
  settleReason: string;
  labels: string[];
  metadata: string;
  durationMs: number;
  occurredAt: Date;
};

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

export abstract class GatewaySpendEventsPort {
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
