import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import type {
  GatewayBudgetClickHouseRepository,
  LedgerEventRow,
} from "../budget.clickhouse.repository";
import { GatewayUsageService } from "../usage.service";

type EventStub = Pick<
  LedgerEventRow,
  "virtualKeyId" | "amountUsd" | "model" | "status" | "occurredAt"
>;

function mockPrisma(
  virtualKeys: Array<{ id: string; name: string; displayPrefix: string }>,
): PrismaClient {
  return {
    virtualKey: {
      findMany: async () => virtualKeys,
      findFirst: async ({
        where,
      }: {
        where: { id: string; projectId: string };
      }) =>
        virtualKeys.some((v) => v.id === where.id) ? { id: where.id } : null,
    },
  } as unknown as PrismaClient;
}

function mockChRepo(events: EventStub[]): GatewayBudgetClickHouseRepository {
  const fullEvents: LedgerEventRow[] = events.map((e, i) => ({
    id: `evt_${i}`,
    budgetId: "budget_test",
    virtualKeyId: e.virtualKeyId,
    amountUsd: e.amountUsd,
    model: e.model,
    providerSlot: null,
    tokensInput: 0,
    tokensOutput: 0,
    durationMs: null,
    status: e.status,
    occurredAt: e.occurredAt,
  }));
  return {
    eventsForVirtualKeys: async () => fullEvents,
  } as unknown as GatewayBudgetClickHouseRepository;
}

const window = {
  fromDate: new Date("2026-04-01T00:00:00Z"),
  toDate: new Date("2026-05-01T00:00:00Z"),
};

describe("GatewayUsageService.summary", () => {
  describe("when the project has no virtual keys", () => {
    it("short-circuits with an empty summary (no ledger read)", async () => {
      const sut = GatewayUsageService.create(mockPrisma([]), mockChRepo([]));
      const result = await sut.summary("proj_01", window);
      expect(result).toEqual({
        totalUsd: "0.000000",
        totalRequests: 0,
        blockedRequests: 0,
        avgUsdPerRequest: "0.000000",
        byVirtualKey: [],
        byModel: [],
        byDay: [],
      });
    });
  });

  describe("when a project has ledger entries", () => {
    it("aggregates by VK, model, and day with sorted top-10", async () => {
      const sut = GatewayUsageService.create(
        mockPrisma([
          { id: "vk_01", name: "prod-openai", displayPrefix: "lw_abc" },
          { id: "vk_02", name: "prod-anthropic", displayPrefix: "lw_def" },
        ]),
        mockChRepo([
          {
            virtualKeyId: "vk_01",
            amountUsd: "1.00",
            model: "gpt-5-mini",
            status: "SUCCESS",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            amountUsd: "2.00",
            model: "gpt-5-mini",
            status: "SUCCESS",
            occurredAt: new Date("2026-04-16T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_02",
            amountUsd: "0.50",
            model: "claude-haiku",
            status: "SUCCESS",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
        ]),
      );

      const result = await sut.summary("proj_01", window);
      expect(result.totalUsd).toBe("3.500000");
      expect(result.totalRequests).toBe(3);
      expect(result.byVirtualKey[0]).toMatchObject({
        virtualKeyId: "vk_01",
        name: "prod-openai",
        totalUsd: "3.000000",
        requests: 2,
      });
      expect(result.byModel[0]?.model).toBe("gpt-5-mini");
      expect(result.byDay.map((b) => b.day)).toEqual([
        "2026-04-15",
        "2026-04-16",
      ]);
    });
  });

  describe("blocked-by-guardrail tally", () => {
    it("counts rows with status BLOCKED_BY_GUARDRAIL separately from totalRequests", async () => {
      const sut = GatewayUsageService.create(
        mockPrisma([{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }]),
        mockChRepo([
          {
            virtualKeyId: "vk_01",
            amountUsd: "0.00",
            model: "gpt-5-mini",
            status: "BLOCKED_BY_GUARDRAIL",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            amountUsd: "1.00",
            model: "gpt-5-mini",
            status: "SUCCESS",
            occurredAt: new Date("2026-04-15T11:00:00Z"),
          },
        ]),
      );
      const result = await sut.summary("proj_01", window);
      expect(result.totalRequests).toBe(2);
      expect(result.blockedRequests).toBe(1);
    });
  });

  describe("avgUsdPerRequest", () => {
    it("is exactly 0 when there are no requests", async () => {
      const sut = GatewayUsageService.create(
        mockPrisma([{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }]),
        mockChRepo([]),
      );
      const result = await sut.summary("proj_01", window);
      expect(result.avgUsdPerRequest).toBe("0.000000");
    });

    it("is totalUsd / totalRequests to 6 decimals", async () => {
      const sut = GatewayUsageService.create(
        mockPrisma([{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }]),
        mockChRepo([
          {
            virtualKeyId: "vk_01",
            amountUsd: "1.234567",
            model: "x",
            status: "SUCCESS",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            amountUsd: "2.345678",
            model: "x",
            status: "SUCCESS",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
        ]),
      );
      const result = await sut.summary("proj_01", window);
      expect(result.avgUsdPerRequest).toBe("1.790123");
    });
  });
});
