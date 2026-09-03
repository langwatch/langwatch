import type { SpendFilters } from "../adapters/gateway-spend-filters.adapter";
import type { SpendBucket, SpendGroupByKey } from "../adapters/gateway-spend-grouping.adapter";
import type {
  SpendEventRow,
  SpendEventsPageCursor,
  SpendSummaryRow,
} from "../repositories/clickhouse/clickhouse.gateway-spend-events.repository";
import type { GatewaySpendState } from "../projections/gateway-spend.projection";

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
