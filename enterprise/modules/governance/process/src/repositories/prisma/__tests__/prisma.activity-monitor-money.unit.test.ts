/**
 * Regression test: money fields must stay string (USD) or BigInt (nano-USD).
 * Number() loses precision past 15 digits; float accumulation drifts.
 * Issue: langwatch/langwatch-saas#1090
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

import { createActivityMonitorTestService } from "../../../__tests__/testing.ts";
import type { ActivityMonitorTraces } from "../../../services/ingestion-source-activity.service.ts";
import type { GovernanceClickHouseResolver } from "../../clickhouse/clickhouse.governance-clickhouse.repositories.ts";

class FakeClickHouseResolver implements GovernanceClickHouseResolver {
  async getClient() {
    return { query };
  }
}

function activityMonitor(prisma: unknown, traces: Partial<ActivityMonitorTraces> = {}) {
  return createActivityMonitorTestService({
    prisma: prisma as never,
    clickhouse: new FakeClickHouseResolver(),
    traces,
  });
}

/**
 * A value ClickHouse's `toString(sum(Float64))` actually produces for a
 * sub-cent spend — `Number("0.000044999999999999996")` is representable,
 * but accumulating floats drifts in a way string-→nano-→string does not.
 */
const CH_FLOAT64_SPEND = "0.000044999999999999996";

/** A nine-decimal-digit cost that Number() rounds. */
const NINE_DIGIT_COST = "0.123456789";

describe("money type lossless round-trip", () => {
  beforeEach(() => {
    query.mockReset();
  });

  describe("when a pushed event carries a sub-cent cost", () => {
    it("preserves the cost as a string, not a lossy Number()", async () => {
      query.mockImplementation(async () => ({ json: async () => [] }));

      const prisma = {
        project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
      };
      const service = activityMonitor(prisma, {
        findAttributedTracesBefore: async () => [
          {
            traceId: "trace-1",
            attributes: { "langwatch.user_id": "user@example.com" },
            firstModel: "gpt-5",
            costUsd: Number(CH_FLOAT64_SPEND),
            promptTokens: 10,
            completionTokens: 4,
            occurredAtMs: 1786619810000,
            createdAtMs: 1786619811000,
          },
        ],
      });

      const rows = await service.eventsForSource({
        organizationId: "org",
        sourceId: "source",
        limit: 50,
      });

      // costUsd must be a string — not Number(CH_FLOAT64_SPEND)
      expect(typeof rows[0]!.costUsd).toBe("string");
      expect(rows[0]!.costUsd).toBe(CH_FLOAT64_SPEND);
    });
  });

  describe("when a pulled OCSF event carries a nine-digit cost", () => {
    it("preserves the cost as a string through the Zod schema", async () => {
      query.mockImplementation(async ({ query: sql }: { query: string }) => ({
        json: async () =>
          sql.includes("governance_ocsf_events")
            ? [
                {
                  eventId: "pulled-1",
                  eventType: "anthropic_admin",
                  actorUserId: "",
                  actorEmail: "pulled@example.com",
                  actorEnduserId: "",
                  action: "usage_report",
                  target: "claude-haiku-4-5",
                  occurredMs: "1786619820000",
                  createdMs: "1786619821000",
                  rawPayload: JSON.stringify({
                    metadata: {
                      extension: {
                        cost_usd: NINE_DIGIT_COST,
                        tokens_input: 8,
                        tokens_output: 5,
                      },
                    },
                  }),
                },
              ]
            : [],
      }));

      const prisma = {
        project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
      };
      const service = activityMonitor(prisma, { findAttributedTracesBefore: async () => [] });

      const rows = await service.eventsForSource({
        organizationId: "org",
        sourceId: "source",
        limit: 50,
      });

      expect(typeof rows[0]!.costUsd).toBe("string");
      expect(rows[0]!.costUsd).toBe(NINE_DIGIT_COST);
    });
  });

  describe("when spendByUser reads trace's spend strings", () => {
    it("keeps spendUsd as a string, not Number()", async () => {
      const prisma = {
        project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
      };
      const service = activityMonitor(prisma, {
        findAttributedSpendByValue: async () => [
          {
            value: "user@example.com",
            spentUsd: CH_FLOAT64_SPEND,
            requests: 5,
            lastOccurredAtMs: 1786619810000,
            firstModel: "gpt-5",
          },
        ],
      });

      const rows = await service.spendByUser({
        organizationId: "org",
        windowDays: 30,
      });

      expect(typeof rows[0]!.spendUsd).toBe("string");
      expect(rows[0]!.spendUsd).toBe(CH_FLOAT64_SPEND);
    });
  });

  describe("when spendByDepartment accumulates across rows", () => {
    it("accumulates through nano-USD integers, not float addition", async () => {
      // Three rows that share one department. Float accumulation of
      // 0.000044999999999999996 × 3 drifts; nano accumulation is exact.
      const depRows = Array.from({ length: 3 }, (_, i) => ({
        projectId: "proj-1",
        value: "",
        spentUsd: CH_FLOAT64_SPEND,
        requests: 1,
        lastOccurredAtMs: 1786619810000 + i,
      }));

      const prisma = {
        project: {
          findFirst: vi.fn(async () => ({ id: "gov-project" })),
          findMany: vi.fn(async () => [{ id: "proj-1", departmentId: "dep-1" }]),
        },
        organizationUser: { findMany: vi.fn(async () => []) },
        department: {
          findMany: vi.fn(async () => [{ id: "dep-1", name: "Engineering" }]),
        },
      };
      const service = activityMonitor(prisma, { findSpendByProjectAndValue: async () => depRows });

      const rows = await service.spendByDepartment({
        organizationId: "org",
        windowDays: 30,
      });

      expect(typeof rows[0]!.spendUsd).toBe("string");
      // 45000 nano × 3 = 135000 nano = 0.000135 USD
      // (the CH float-drift suffix is rounded away by nano conversion)
      expect(rows[0]!.spendUsd).toBe("0.000135");
    });
  });
});
