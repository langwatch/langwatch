import { Prisma } from "@langwatch/prisma-client/generated";
import { type Instant, Temporal, toDate } from "@langwatch/time";
import type {
  TraceApi,
  TraceAttributedTrace,
  TraceAttributeUsageBucket,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import {
  GatewayUsageService,
  type GatewayUsageProjects,
  type GatewayUsageVirtualKeys,
} from "../services/gateway-usage.service.ts";

type TraceStub = {
  virtualKeyId: string;
  costUsd: string;
  occurredAt: Instant;
  model?: string;
  blockedByGuardrail?: boolean;
  projectId?: string;
};

const DEFAULT_PROJECT = "proj_01";

/** The org's projects: the tenant set gateway traces can land in. */
function mockProjects(traces: TraceStub[]): GatewayUsageProjects {
  const ids = new Set([DEFAULT_PROJECT, ...traces.map((t) => t.projectId ?? DEFAULT_PROJECT)]);
  return { listIdsByOrganization: async () => [...ids] };
}

/**
 * Names and prefixes for keys of the organization asked about — the real
 * repository filters on both, so a fake that ignored organization would
 * let a mis-scoped read look correct here.
 */
function mockVirtualKeys(
  virtualKeys: { id: string; name: string; displayPrefix: string; organizationId?: string }[],
  belongingTo = "org_01",
): GatewayUsageVirtualKeys {
  return {
    findMetaByIds: async ({ organizationId, ids }) =>
      virtualKeys.filter(
        (key) => ids.includes(key.id) && (key.organizationId ?? belongingTo) === organizationId,
      ),
  };
}

/** Trace's single-tenant reads over the stubs: each call answers one project only. */
function mockTraces(
  traces: TraceStub[],
): Pick<
  TraceApi,
  "findSpendByAttributeValue" | "findAttributeUsageBuckets" | "findAttributedTraces"
> {
  const rows = traces.map((t, i) => ({
    projectId: t.projectId ?? DEFAULT_PROJECT,
    trace: {
      traceId: `trace_${i}`,
      value: t.virtualKeyId,
      costUsd: t.costUsd,
      models: [t.model ?? "gpt-5-mini"],
      occurredAtMs: t.occurredAt.epochMilliseconds,
      promptTokens: 0,
      completionTokens: 0,
      durationMs: 0,
      hasError: false,
      blockedByGuardrail: t.blockedByGuardrail ?? false,
    } satisfies TraceAttributedTrace,
  }));
  const inTenant = (input: { projectId: string; values?: string[] }) =>
    rows
      .filter((r) => r.projectId === input.projectId)
      .map((r) => r.trace)
      .filter((t) => !input.values || input.values.includes(t.value));
  const bucketsFor = (subset: TraceAttributedTrace[]): TraceAttributeUsageBucket[] => {
    const byKey = new Map<string, TraceAttributeUsageBucket>();
    for (const t of subset) {
      const model = t.models[0] ?? "unknown";
      const day = toDate(Temporal.Instant.fromEpochMilliseconds(t.occurredAtMs))
        .toISOString()
        .slice(0, 10);
      const key = `${t.value}|${model}|${day}`;
      const existing = byKey.get(key);
      byKey.set(key, {
        value: t.value,
        model,
        day,
        totalUsd: existing
          ? new Prisma.Decimal(existing.totalUsd).plus(t.costUsd).toString()
          : t.costUsd,
        requests: (existing?.requests ?? 0) + 1,
        blockedRequests: (existing?.blockedRequests ?? 0) + (t.blockedByGuardrail ? 1 : 0),
      });
    }
    return [...byKey.values()];
  };
  return {
    findSpendByAttributeValue: async (input) =>
      bucketsFor(inTenant(input)).map((b) => ({
        value: b.value,
        spentUsd: b.totalUsd,
        requests: b.requests,
      })),
    findAttributeUsageBuckets: async (input) => bucketsFor(inTenant(input)),
    findAttributedTraces: async (input) =>
      inTenant(input)
        .filter((t) => !input.model || (t.models[0] ?? "unknown") === input.model)
        .toSorted((a, b) => b.occurredAtMs - a.occurredAtMs)
        .slice(0, input.limit),
  };
}

function service(
  virtualKeys: { id: string; name: string; displayPrefix: string }[],
  traces: TraceStub[],
): GatewayUsageService {
  return GatewayUsageService.create({
    projects: mockProjects(traces),
    virtualKeys: mockVirtualKeys(virtualKeys),
    chRepo: undefined,
    traces: mockTraces(traces),
  });
}

const window = {
  fromDate: Temporal.Instant.from("2026-04-01T00:00:00Z"),
  toDate: Temporal.Instant.from("2026-05-01T00:00:00Z"),
};

describe("GatewayUsageService.summary", () => {
  describe("when the org has no gateway traffic", () => {
    it("returns an empty summary", async () => {
      const result = await service(
        [{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }],
        [],
      ).summary({
        organizationId: "org_01",
        virtualKeyIds: ["vk_01"],
        window,
      });
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
            occurredAt: Temporal.Instant.from("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            costUsd: "2.00",
            occurredAt: Temporal.Instant.from("2026-04-16T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_02",
            costUsd: "0.50",
            model: "claude-haiku",
            occurredAt: Temporal.Instant.from("2026-04-15T10:00:00Z"),
          },
        ],
      ).summary({
        organizationId: "org_01",
        virtualKeyIds: ["vk_01", "vk_02"],
        window,
      });

      expect(result.totalUsd).toBe("3.500000");
      expect(result.totalRequests).toBe(3);
      expect(result.byVirtualKey[0]).toMatchObject({
        virtualKeyId: "vk_01",
        name: "prod-openai",
        totalUsd: "3.000000",
        requests: 2,
      });
      expect(result.byModel[0]?.model).toBe("gpt-5-mini");
      expect(result.byDay.map((b) => b.day)).toEqual(["2026-04-15", "2026-04-16"]);
    });

    it("falls back to the key id when its display name cannot be resolved", async () => {
      // Only the display name comes from Postgres; a name we cannot
      // resolve falls back to the id rather than dropping the row.
      const result = await service(
        [],
        [
          {
            virtualKeyId: "vk_org_wide",
            costUsd: "0.75",
            occurredAt: Temporal.Instant.from("2026-04-15T10:00:00Z"),
          },
        ],
      ).summary({
        organizationId: "org_01",
        virtualKeyIds: ["vk_org_wide"],
        window,
      });
      expect(result.byVirtualKey[0]).toMatchObject({
        virtualKeyId: "vk_org_wide",
        name: "vk_org_wide",
        totalUsd: "0.750000",
      });
    });
  });

  describe("when a request is blocked by a guardrail", () => {
    it("counts blocked requests separately from totalRequests", async () => {
      const result = await service(
        [{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }],
        [
          {
            virtualKeyId: "vk_01",
            costUsd: "0.00",
            blockedByGuardrail: true,
            occurredAt: Temporal.Instant.from("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            costUsd: "1.00",
            occurredAt: Temporal.Instant.from("2026-04-15T11:00:00Z"),
          },
        ],
      ).summary({
        organizationId: "org_01",
        virtualKeyIds: ["vk_01"],
        window,
      });
      expect(result.totalRequests).toBe(2);
      expect(result.blockedRequests).toBe(1);
    });
  });

  describe("when computing avgUsdPerRequest", () => {
    it("is exactly 0 when there are no requests", async () => {
      const result = await service(
        [{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }],
        [],
      ).summary({
        organizationId: "org_01",
        virtualKeyIds: ["vk_01"],
        window,
      });
      expect(result.avgUsdPerRequest).toBe("0.000000");
    });

    it("is totalUsd / totalRequests to 6 decimals", async () => {
      const result = await service(
        [{ id: "vk_01", name: "prod", displayPrefix: "lw_abc" }],
        [
          {
            virtualKeyId: "vk_01",
            costUsd: "1.234567",
            occurredAt: Temporal.Instant.from("2026-04-15T10:00:00Z"),
          },
          {
            virtualKeyId: "vk_01",
            costUsd: "2.345678",
            occurredAt: Temporal.Instant.from("2026-04-15T10:00:00Z"),
          },
        ],
      ).summary({
        organizationId: "org_01",
        virtualKeyIds: ["vk_01"],
        window,
      });
      expect(result.avgUsdPerRequest).toBe("1.790123");
    });
  });
});

describe("GatewayUsageService across the org's projects", () => {
  const keys = [
    { id: "vk_01", name: "prod", displayPrefix: "lw_a" },
    { id: "vk_02", name: "org", displayPrefix: "lw_b" },
  ];
  const at = (iso: string) => Temporal.Instant.from(iso);
  const traffic: TraceStub[] = [
    { virtualKeyId: "vk_01", costUsd: "0.4", occurredAt: at("2026-04-02T10:00:00Z") },
    {
      virtualKeyId: "vk_01",
      costUsd: "0.25",
      occurredAt: at("2026-04-03T10:00:00Z"),
      model: "claude-sonnet-4",
    },
    { virtualKeyId: "vk_02", costUsd: "0.123456", occurredAt: at("2026-04-04T10:00:00Z") },
    {
      virtualKeyId: "vk_02",
      costUsd: "0.000045",
      occurredAt: at("2026-04-05T10:00:00Z"),
      blockedByGuardrail: true,
    },
  ];
  const split = traffic.map((t, i) => ({ ...t, projectId: i % 2 === 0 ? "proj_01" : "proj_gov" }));

  describe("when the same traces land in two tenants instead of one", () => {
    /** @scenario "Spend that lands in the key's trace project is visible from anywhere in the organization" */
    it("merges each tenant's reads into the answer one query over both would give", async () => {
      const whole = service(keys, traffic);
      const merged = service(keys, split);
      const ids = ["vk_01", "vk_02"];

      expect(
        await merged.summary({ organizationId: "org_01", virtualKeyIds: ids, window }),
      ).toEqual(await whole.summary({ organizationId: "org_01", virtualKeyIds: ids, window }));
      expect(
        await merged.spendByVirtualKey({ organizationId: "org_01", virtualKeyIds: ids, window }),
      ).toEqual(
        await whole.spendByVirtualKey({ organizationId: "org_01", virtualKeyIds: ids, window }),
      );
      for (const virtualKeyId of ids) {
        expect(
          await merged.summaryForVirtualKey({ organizationId: "org_01", virtualKeyId, window }),
        ).toEqual(
          await whole.summaryForVirtualKey({ organizationId: "org_01", virtualKeyId, window }),
        );
      }
    });
  });

  describe("when spend is read per key for the keys table", () => {
    /** @scenario "A key with no budget still reports what it spent" */
    /** @scenario "A key covered by several budgets is not counted once per budget" */
    it("reports each key's trace spend once, summed across tenants", async () => {
      const spend = await service(keys, split).spendByVirtualKey({
        organizationId: "org_01",
        virtualKeyIds: ["vk_01", "vk_02"],
        window,
      });

      expect(spend.get("vk_01")).toEqual({ spentUsd: "0.65", requests: 2 });
      expect(spend.get("vk_02")).toEqual({ spentUsd: "0.123501", requests: 2 });
    });
  });

  describe("when one key's usage is read", () => {
    /** @scenario "Spend is reported per key with its own daily and model split" */
    it("splits the key's spend by day and model", async () => {
      const summary = await service(keys, split).summaryForVirtualKey({
        organizationId: "org_01",
        virtualKeyId: "vk_01",
        window,
      });

      expect(summary.byModel.map((m) => m.model).toSorted()).toEqual([
        "claude-sonnet-4",
        "gpt-5-mini",
      ]);
      expect(summary.byDay.map((d) => d.day)).toEqual(["2026-04-02", "2026-04-03"]);
      expect(summary.recentDebits.map((d) => d.occurredAt)).toEqual([
        "2026-04-03T10:00:00.000Z",
        "2026-04-02T10:00:00.000Z",
      ]);
    });

    /** @scenario "Picking a model narrows the recent activity to that model" */
    /** @scenario "Clicking the picked model again clears the filter" */
    it("narrows only the recent list to the picked model, and widens it again without one", async () => {
      const usage = service(keys, split);
      const all = await usage.summaryForVirtualKey({
        organizationId: "org_01",
        virtualKeyId: "vk_01",
        window,
      });
      const picked = await usage.summaryForVirtualKey({
        organizationId: "org_01",
        virtualKeyId: "vk_01",
        window,
        model: "claude-sonnet-4",
      });

      expect(picked.recentDebits.map((d) => d.model)).toEqual(["claude-sonnet-4"]);
      expect(all.recentDebits).toHaveLength(2);
      expect({ ...picked, recentDebits: [] }).toEqual({ ...all, recentDebits: [] });
    });
  });
});
