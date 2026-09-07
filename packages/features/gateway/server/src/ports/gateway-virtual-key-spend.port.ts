import type { Instant } from "@langwatch/time";

export type GatewayVirtualKeySpend = {
  virtualKeyId: string;
  spentUsd: string;
  requests: number;
};

export type GatewaySpendWindow = {
  fromDate: Instant;
  toDate: Instant;
};

export type GatewayUsageBucket = {
  virtualKeyId: string;
  model: string;
  day: string;
  totalUsd: string;
  requests: number;
  blockedRequests: number;
};

export type GatewayTraceRow = {
  traceId: string;
  virtualKeyId: string;
  costUsd: string;
  models: string[];
  occurredAt: Instant;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
  hasError: boolean;
  blockedByGuardrail: boolean;
};

export abstract class GatewayVirtualKeySpendPort {
  abstract spendByVirtualKey(input: {
    tenantIds: string[];
    virtualKeyIds: string[];
    window: GatewaySpendWindow;
  }): Promise<GatewayVirtualKeySpend[]>;

  abstract usageBuckets(input: {
    tenantIds: string[];
    window: GatewaySpendWindow;
    virtualKeyIds?: string[];
  }): Promise<GatewayUsageBucket[]>;

  abstract gatewayTraces(input: {
    tenantIds: string[];
    window: GatewaySpendWindow;
    virtualKeyIds?: string[];
    model?: string;
    limit: number;
  }): Promise<GatewayTraceRow[]>;
}
