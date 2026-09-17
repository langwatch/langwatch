// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GatewaySpendRepository } from "../gateway-spend.repository.ts";
import type {
  GovernanceGatewaySpendDayRow,
  GovernanceGatewaySpendModelRow,
  GovernanceGatewaySpendVirtualKeyRow,
  GovernanceGatewaySpendWindow,
} from "../gateway-spend.repository.ts";

const CHARGED_STATUSES = new Set(["confirmed", "failed"]);

/** One collapsed gateway request, as a test seeds it. */
export type MemoryGatewaySpendRequest = {
  tenantId: string;
  /** `YYYY-MM-DD`, the day the request started in UTC. */
  day: string;
  status: "confirmed" | "failed" | "settled";
  amountNanoUsd: number;
  model: string;
  virtualKeyId: string;
  tokensTotal: number;
};

type Figures = {
  amountNanoUsd: number;
  requestCount: number;
  pricedRequestCount: number;
  requestsWithoutAmount: number;
};

function fold(requests: MemoryGatewaySpendRequest[]): Figures {
  const figures: Figures = {
    amountNanoUsd: 0,
    requestCount: 0,
    pricedRequestCount: 0,
    requestsWithoutAmount: 0,
  };
  for (const request of requests) {
    const charged = CHARGED_STATUSES.has(request.status);
    if (charged) {
      figures.amountNanoUsd += request.amountNanoUsd;
      figures.requestCount += 1;
      if (request.amountNanoUsd > 0) figures.pricedRequestCount += 1;
      else if (request.tokensTotal > 0) figures.requestsWithoutAmount += 1;
    } else if (request.status === "settled") {
      figures.requestsWithoutAmount += 1;
    }
  }
  return figures;
}

/**
 * The gateway-spend twin: a seeded log of collapsed requests, folded the
 * same way `ClickHouseGatewaySpendRepository` folds the ledger — charged
 * statuses only in the money sum, `requestsWithoutAmount` counted beside it.
 */
export class MemoryGatewaySpendRepository extends GatewaySpendRepository {
  private readonly requests: MemoryGatewaySpendRequest[] = [];

  static create(): MemoryGatewaySpendRepository {
    return new MemoryGatewaySpendRepository();
  }

  record(request: MemoryGatewaySpendRequest): void {
    this.requests.push(request);
  }

  async sumDaysForOrganizationProjects(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendDayRow[]> {
    if (input.tenantIds.length === 0) return [];
    const byDay = new Map<string, MemoryGatewaySpendRequest[]>();
    for (const request of this.inWindow(input)) {
      const bucket = byDay.get(request.day) ?? [];
      bucket.push(request);
      byDay.set(request.day, bucket);
    }
    return [...byDay.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([day, requests]) => ({ day, ...fold(requests) }));
  }

  async sumWindowByModel(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendModelRow[]> {
    if (input.tenantIds.length === 0) return [];
    const byModel = new Map<string, MemoryGatewaySpendRequest[]>();
    for (const request of this.inWindow(input)) {
      const bucket = byModel.get(request.model) ?? [];
      bucket.push(request);
      byModel.set(request.model, bucket);
    }
    return [...byModel.entries()]
      .map(([model, requests]) => ({ model, ...fold(requests) }))
      .toSorted((a, b) => b.amountNanoUsd - a.amountNanoUsd || a.model.localeCompare(b.model));
  }

  async sumWindowByVirtualKey(
    input: GovernanceGatewaySpendWindow,
  ): Promise<GovernanceGatewaySpendVirtualKeyRow[]> {
    if (input.tenantIds.length === 0) return [];
    const byKey = new Map<string, MemoryGatewaySpendRequest[]>();
    for (const request of this.inWindow(input)) {
      const bucket = byKey.get(request.virtualKeyId) ?? [];
      bucket.push(request);
      byKey.set(request.virtualKeyId, bucket);
    }
    return [...byKey.entries()]
      .map(([virtualKeyId, requests]) => ({ virtualKeyId, ...fold(requests) }))
      .toSorted(
        (a, b) => b.amountNanoUsd - a.amountNanoUsd || a.virtualKeyId.localeCompare(b.virtualKeyId),
      );
  }

  private inWindow(input: GovernanceGatewaySpendWindow): MemoryGatewaySpendRequest[] {
    const tenantIds = new Set(input.tenantIds);
    return this.requests.filter(
      (request) =>
        tenantIds.has(request.tenantId) &&
        request.day >= input.fromDay &&
        request.day <= input.toDay,
    );
  }
}
