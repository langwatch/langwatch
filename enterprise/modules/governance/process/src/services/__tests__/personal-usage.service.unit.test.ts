import { createApiFixture } from "@langwatch/api-fixture";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { DefaultGovernancePersonalUsageService } from "../personal-usage.service.ts";

function traceFixture() {
  return createApiFixture<TraceApi>({
    getSpendSummary: vi.fn(async () => ({
      totalCost: 4,
      billedCost: 3,
      requestCount: 4,
      promptTokens: 10,
      completionTokens: 20,
    })),
    findTopModelsByRequests: vi.fn(async () => [{ model: "trace-model", requests: 3 }]),
    findDailySpend: vi.fn(async () => [
      { day: "2026-08-01", spentUsd: 4, billedUsd: 3, requests: 4 },
    ]),
    findModelSpend: vi.fn(async () => [
      { label: "trace-model", spentUsd: 4, billedUsd: 3, requests: 4 },
    ]),
  });
}

function ledgerFixture() {
  return createApiFixture<GatewayApi>({
    getPrincipalSpendSummary: vi.fn(async () => ({
      totalCost: 2,
      requestCount: 2,
      promptTokens: 5,
      completionTokens: 7,
      topModel: { name: "ledger-model", requests: 2 },
    })),
    findPrincipalDailySpend: vi.fn(async () => [
      { day: "2026-08-01", spentUsd: 2, billedUsd: 2, requests: 2 },
    ]),
    findPrincipalModelSpend: vi.fn(async () => [
      { label: "ledger-model", spentUsd: 2, billedUsd: 2, requests: 2 },
    ]),
  });
}

const input = {
  personalProjectId: "personal-project",
  userId: "user",
  ingestionTenantId: "governance-project",
  window: {
    startMs: Date.parse("2026-08-01T00:00:00.000Z"),
    endMs: Date.parse("2026-08-03T00:00:00.000Z"),
  },
};

describe("DefaultGovernancePersonalUsageService", () => {
  it("merges trace and principal-ledger summaries", async () => {
    const result = await DefaultGovernancePersonalUsageService.create({
      traces: traceFixture(),
      ledger: ledgerFixture(),
    }).summary(input);

    expect(result).toEqual({
      spentUsd: 6,
      billedUsd: 5,
      requests: 6,
      promptTokens: 15,
      completionTokens: 27,
      mostUsedModel: { name: "trace-model", usagePct: 50 },
    });
  });

  it("fills empty UTC days and merges ledger buckets", async () => {
    const result = await DefaultGovernancePersonalUsageService.create({
      traces: traceFixture(),
      ledger: ledgerFixture(),
    }).dailyBuckets(input);

    expect(result).toEqual([
      { day: "2026-08-01", spentUsd: 6, billedUsd: 5, requests: 6 },
      { day: "2026-08-02", spentUsd: 0, billedUsd: 0, requests: 0 },
    ]);
  });

  it("keeps trace usage available when the best-effort ledger fails", async () => {
    const result = await DefaultGovernancePersonalUsageService.create({
      traces: traceFixture(),
      ledger: {
        ...ledgerFixture(),
        getPrincipalSpendSummary: vi.fn().mockRejectedValue(new Error("ClickHouse unavailable")),
      },
    }).summary(input);
    expect(result.spentUsd).toBe(4);
    expect(result.requests).toBe(4);
  });

  it("reads the personal project from traces and the ingestion tenant from the ledger", async () => {
    const findModelSpend = vi.fn(async () => []);
    const findPrincipalModelSpend = vi.fn(async () => []);

    await DefaultGovernancePersonalUsageService.create({
      traces: createApiFixture<TraceApi>({ findModelSpend }),
      ledger: createApiFixture<GatewayApi>({ findPrincipalModelSpend }),
    }).breakdownByModel(input, 3);

    expect(findModelSpend).toHaveBeenCalledWith({
      projectId: "personal-project",
      window: input.window,
      limit: 3,
    });
    expect(findPrincipalModelSpend).toHaveBeenCalledWith({
      projectId: "governance-project",
      userId: "user",
      window: input.window,
    });
  });
});
