import type { SpendFilters } from "../adapters/gateway-spend-filters.adapter";
import type { SpendBucket, SpendGroupByKey } from "../adapters/gateway-spend-grouping.adapter";
import type {
  SpendEventRow,
  SpendEventsPageCursor,
  SpendSummaryRow,
} from "../repositories/clickhouse/clickhouse.gateway-spend-events.repository";
import type { GatewaySpendEventsPort } from "../ports/gateway-spend-events.port";

export class GatewaySpendEventsService {
  private constructor(private readonly repository: GatewaySpendEventsPort) {}

  static create(repository: GatewaySpendEventsPort): GatewaySpendEventsService {
    return new GatewaySpendEventsService(repository);
  }

  getSpendEventsPage(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    filters?: SpendFilters;
    cursor?: SpendEventsPageCursor;
    limit?: number;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: SpendEventsPageCursor | null }> {
    return this.repository.readSpendEventsPage(input);
  }

  getSpendSummaries(input: {
    tenantIds: string[];
    groupBy: SpendGroupByKey[];
    bucket?: SpendBucket;
    timezone?: string;
    fromMs: number;
    toMs: number;
    cursor?: string | null;
    limit?: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendSummaryRow[]; nextCursor: string | null }> {
    return this.repository.readSpendSummaries(input);
  }

  walkSpendEvents(input: {
    tenantIds: string[];
    fromMs?: number;
    toMs?: number;
    cursor?: string | null;
    limit: number;
    filters?: SpendFilters;
  }): Promise<{ rows: SpendEventRow[]; nextCursor: string | null }> {
    return this.repository.walkSpendEvents(input);
  }

  getEndUserSpend(input: {
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
  }> {
    return this.repository.readEndUserSpend(input);
  }
}
