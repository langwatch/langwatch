import { describe, expect, it, vi } from "vitest";
import { PersonalUsageReaderPort } from "../src/ports/personal-usage.port";
import { DefaultGovernancePersonalUsageService } from "../src/services/personal-usage.service";

class StubPersonalUsageReader extends PersonalUsageReaderPort {
  findSummary = vi.fn(async () => ({
    totalCost: 4,
    billedCost: 3,
    requestCount: 4,
    promptTokens: 10,
    completionTokens: 20,
  }));
  tryFindTopModel = vi.fn(async () => ({ model: "trace-model", requests: 3 }));
  findDailyBuckets = vi.fn(async () => [
    { day: "2026-08-01", spentUsd: 4, billedUsd: 3, requests: 4 },
  ]);
  findModelBreakdown = vi.fn(async () => [
    { label: "trace-model", spentUsd: 4, billedUsd: 3, requests: 4 },
  ]);
  tryFindIngestionPrincipalSummary = vi.fn(async () => ({
    totalCost: 2,
    requestCount: 2,
    promptTokens: 5,
    completionTokens: 7,
    topModel: { name: "ledger-model", requests: 2 },
  }));
  findIngestionPrincipalBuckets = vi.fn(async () => [
    { day: "2026-08-01", spentUsd: 2, billedUsd: 2, requests: 2 },
  ]);
  findIngestionPrincipalBreakdown = vi.fn(async () => [
    { label: "ledger-model", spentUsd: 2, billedUsd: 2, requests: 2 },
  ]);
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
      reader: new StubPersonalUsageReader(),
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
      reader: new StubPersonalUsageReader(),
    }).dailyBuckets(input);

    expect(result).toEqual([
      { day: "2026-08-01", spentUsd: 6, billedUsd: 5, requests: 6 },
      { day: "2026-08-02", spentUsd: 0, billedUsd: 0, requests: 0 },
    ]);
  });

  it("keeps trace usage available when the best-effort ledger fails", async () => {
    const reader = new StubPersonalUsageReader();
    reader.tryFindIngestionPrincipalSummary.mockRejectedValueOnce(
      new Error("ClickHouse unavailable"),
    );

    const result = await DefaultGovernancePersonalUsageService.create({
      reader,
    }).summary(input);
    expect(result.spentUsd).toBe(4);
    expect(result.requests).toBe(4);
  });

  it("degrades to the complete empty state without a reader", async () => {
    const service = DefaultGovernancePersonalUsageService.create({});
    await expect(service.summary(input)).resolves.toMatchObject({
      spentUsd: 0,
      requests: 0,
      mostUsedModel: null,
    });
    await expect(service.breakdownByModel(input)).resolves.toEqual([]);
  });
});
