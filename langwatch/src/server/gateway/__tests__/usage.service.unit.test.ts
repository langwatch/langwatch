import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { GatewayUsageService } from "../usage.service";
import type {
  GatewayTraceRow,
  GatewayVirtualKeySpendRepository,
} from "../virtualKeySpend.clickhouse.repository";

type TraceStub = Pick<
  GatewayTraceRow,
  "virtualKeyId" | "costUsd" | "occurredAt"
> & {
  model?: string;
  blockedByGuardrail?: boolean;
};

function mockPrisma(
  virtualKeys: Array<{ id: string; name: string; displayPrefix: string }>,
): PrismaClient {
  return {
    virtualKey: {
      findMany: async () => virtualKeys,
      findFirst: async ({ where }: { where: { id: string } }) =>
        virtualKeys.some((v) => v.id === where.id) ? { id: where.id } : null,
    },
    project: {
      findUnique: async () => ({
        id: "proj_01",
        teamId: "team_01",
        team: { organizationId: "org_01" },
      }),
      findMany: async () => [{ id: "proj_01" }],
    },
  } as unknown as PrismaClient;
}

function mockSpendRepo(
  traces: TraceStub[],
): GatewayVirtualKeySpendRepository {
  const rows: GatewayTraceRow[] = traces.map((t, i) => ({
    traceId: `trace_${i}`,
    virtualKeyId: t.virtualKeyId,
    costUsd: t.costUsd,
    models: [t.model ?? "gpt-5-mini"],
    occurredAt: t.occurredAt,
    promptTokens: 0,
    completionTokens: 0,
    durationMs: 0,
    hasError: false,
    blockedByGuardrail: t.blockedByGuardrail ?? false,
  }));
  return {
    gatewayTraces: async ({
      virtualKeyIds,
    }: {
      virtualKeyIds?: string[];
    }) =>
      virtualKeyIds
        ? rows.filter((r) => virtualKeyIds.includes(r.virtualKeyId))
        : rows,
    spendByVirtualKey: async () => [],
  } as unknown as GatewayVirtualKeySpendRepository;
}

function service(
  virtualKeys: Array<{ id: string; name: string; displayPrefix: string }>,
  traces: TraceStub[],
): GatewayUsageService {
  return GatewayUsageService.create({
    prisma: mockPrisma(virtualKeys),
    chRepo: undefined,
    spendRepo: mockSpendRepo(traces),
  });
}

const window = {
  fromDate: new Date("2026-04-01T00:00:00Z"),
  toDate: new Date("2026-05-01T00:00:00Z"),
};

describe("GatewayUsageService.summary", () => {
  describe("when the project has no gateway traffic", () => {
    it("returns an empty summary", async () => {
      const result = await service([], []).summary("proj_01", window);
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

  describe("when a project has gateway traffic", () => {
    it("aggregates by VK, model, and day with sorted top-10", async () => {
      const result = await service(
        [
          { id: "vk_01", name: "prod-openai", displayPrefix: "lw_abc" },
          { id: "vk_02", name: "prod-anthropic", displayPrefix: "lw_def" },
        ],
        [
          {
            virtualKeyId: "vk_01",
            costUsd: "1.00",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            costUsd: "2.00",
            occurredAt: new Date("2026-04-16T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_02",
            costUsd: "0.50",
            model: "claude-haiku",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
        ],
      ).summary("proj_01", window);

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

    it("names a key that spent here even when it is scoped above the project", async () => {
      // The key list no longer gates the query: an org- or team-scoped key
      // spends in this project and must be visible on its Usage tab. Only
      // its display name comes from Postgres, and a name we cannot resolve
      // falls back to the id rather than dropping the row.
      const result = await service(
        [],
        [
          {
            virtualKeyId: "vk_org_wide",
            costUsd: "0.75",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
        ],
      ).summary("proj_01", window);
      expect(result.byVirtualKey[0]).toMatchObject({
        virtualKeyId: "vk_org_wide",
        name: "vk_org_wide",
        totalUsd: "0.750000",
      });
    });
  });

  describe("blocked-by-guardrail tally", () => {
    it("counts blocked requests separately from totalRequests", async () => {
      const result = await service(
        [{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }],
        [
          {
            virtualKeyId: "vk_01",
            costUsd: "0.00",
            blockedByGuardrail: true,
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            costUsd: "1.00",
            occurredAt: new Date("2026-04-15T11:00:00Z"),
          },
        ],
      ).summary("proj_01", window);
      expect(result.totalRequests).toBe(2);
      expect(result.blockedRequests).toBe(1);
    });
  });

  describe("avgUsdPerRequest", () => {
    it("is exactly 0 when there are no requests", async () => {
      const result = await service(
        [{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }],
        [],
      ).summary("proj_01", window);
      expect(result.avgUsdPerRequest).toBe("0.000000");
    });

    it("is totalUsd / totalRequests to 6 decimals", async () => {
      const result = await service(
        [{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }],
        [
          {
            virtualKeyId: "vk_01",
            costUsd: "1.234567",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            costUsd: "2.345678",
            occurredAt: new Date("2026-04-15T10:00:00Z"),
          },
        ],
      ).summary("proj_01", window);
      expect(result.avgUsdPerRequest).toBe("1.790123");
    });
  });
});
