import type { SpendEventRow, SpendFilters } from "@langwatch/gateway-contract";

import type {
  GatewaySpendEvents,
  SpendBucket,
  SpendEventsPageCursor,
  SpendGroupByKey,
  SpendSummaryRow,
} from "../repositories/gateway-spend-events.repository.ts";

export class GatewaySpendEventsService {
  private constructor(private readonly repository: GatewaySpendEvents) {}

  static create(repository: GatewaySpendEvents): GatewaySpendEventsService {
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

  /** What one request type has cost these tenants, in integer nano-USD. */
  sumSpendNanoUsdByRequestType(input: {
    tenantIds: string[];
    requestType: string;
    fromMs?: number;
    toMs?: number;
  }): Promise<number> {
    return this.repository.sumCostNanoUsdByRequestType(input);
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
    tokensInputImage: number;
    tokensOutputImage: number;
    imageCount: number;
  }> {
    return this.repository.readEndUserSpend(input);
  }
}
