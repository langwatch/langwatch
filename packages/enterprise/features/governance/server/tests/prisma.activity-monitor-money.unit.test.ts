/**
 * Regression: money fields must stay string (USD) or BigInt (nano-USD).
 *
 * `Number()` on a decimal string is lossy past ~15 significant digits,
 * and float accumulation drifts. Every USD amount entering or leaving
 * the governance read path must be a decimal string; intermediate
 * accumulation must go through nano-USD integers.
 *
 * Issue: langwatch/langwatch-saas#1090
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

import { GovernanceClickHouseResolverPort } from "../src/ports/ingestion-source-activity.port";
import { PrismaActivityMonitorRepository } from "../src/repositories/prisma/prisma-ingestion-source-activity.repository";

class FakeClickHouseResolver extends GovernanceClickHouseResolverPort {
  async tryResolve() {
    return { query };
  }
}

function activityMonitor(prisma: unknown) {
  return PrismaActivityMonitorRepository.create({
    prisma: prisma as never,
    clickhouse: new FakeClickHouseResolver(),
  });
}

/**
 * A value ClickHouse's `toString(sum(Float64))` actually produces for a
 * sub-cent spend. `Number("0.000044999999999999996")` gives
 * `0.000044999999999999996`, which is representable, but accumulating
 * several of those as floats drifts in a way that the string-→nano-→string
 * round-trip does not.
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
      query.mockImplementation(async () => ({
        json: async () => [
          {
            eventId: "trace-1",
            eventType: "otel_generic",
            actor: "user@example.com",
            target: "gpt-5",
            costUsd: CH_FLOAT64_SPEND,
            tokensInput: 10,
            tokensOutput: 4,
            occurredMs: "1786619810000",
            createdMs: "1786619811000",
          },
        ],
      }));

      const prisma = {
        project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
      };
      const service = activityMonitor(prisma);

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
      const service = activityMonitor(prisma);

      const rows = await service.eventsForSource({
        organizationId: "org",
        sourceId: "source",
        limit: 50,
      });

      expect(typeof rows[0]!.costUsd).toBe("string");
      expect(rows[0]!.costUsd).toBe(NINE_DIGIT_COST);
    });
  });

  describe("when spendByUser returns CH spend strings", () => {
    it("keeps spendUsd as a string, not Number()", async () => {
      query.mockImplementation(async () => ({
        json: async () => [
          {
            actor: "user@example.com",
            spendUsdStr: CH_FLOAT64_SPEND,
            requests: "5",
            lastActivityMs: "1786619810000",
            mostUsedTarget: "gpt-5",
          },
        ],
      }));

      const prisma = {
        project: { findFirst: vi.fn(async () => ({ id: "gov-project" })) },
      };
      const service = activityMonitor(prisma);

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
        actor: "",
        spendUsdStr: CH_FLOAT64_SPEND,
        requests: "1",
        lastActivityMs: String(1786619810000 + i),
      }));

      query.mockImplementation(async () => ({
        json: async () => depRows,
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
      const service = activityMonitor(prisma);

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
