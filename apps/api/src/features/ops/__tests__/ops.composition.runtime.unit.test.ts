/**
 * What the API process composes the operator runtime from: the process-manager
 * fleet over its own Postgres, and the ops snapshot over its own Redis
 * (specs/ops/process-manager-visibility.feature, specs/ops/shared-ops-snapshot.feature).
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { AuthService } from "@langwatch/auth-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import type { UserService } from "@langwatch/user-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiOpsAbsenceReport, composeOpsFeature } from "../ops.composition.ts";

/** The two fleet reads, in the order the repository issues them. */
function fleetPrisma(rows: { instances: unknown[]; outbox: unknown[] }) {
  const answers = [rows.instances, rows.outbox];
  const queryRaw = vi.fn(async () => answers.shift() ?? []);
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async () => []),
    processManagerInbox: {},
    processManagerInstance: {},
    processManagerOutbox: {},
    processManagerOutboxAttempt: {},
  } as unknown as PrismaClient;
  return { queryRaw, prisma };
}

/** Records every key the snapshot reader asks Redis for. */
function readingRedis() {
  const asked: string[] = [];
  return {
    asked,
    connection: {
      get: async (key: string) => {
        asked.push(key);
        return null;
      },
    } as unknown as RedisConnection,
  };
}

class RecordingAbsence extends ApiOpsAbsenceReport {
  readonly reported: string[] = [];

  absent(capability: "replay-runtime" | "ops-snapshot"): void {
    this.reported.push(capability);
  }
}

function compose(options: { prisma: PrismaClient; redis?: RedisConnection | null }) {
  const report = new RecordingAbsence();
  const feature = composeOpsFeature({
    infrastructure: {
      prisma: options.prisma,
      authz: {} as never,
      plans: {} as never,
      featureFlags: {} as unknown as FeatureFlagApi,
      saasBilling: false,
      audit: undefined,
      auditLog: createApiFixture<AuditLogApi>(),
    },
    peers: {
      users: {} as unknown as UserService,
      auth: {} as unknown as AuthService,
      projects: {} as unknown as ProjectService,
    },
    adminEmails: ["operator@acme.test"],
    eventLogClient: null,
    eventing: undefined,
    redis: options.redis ?? null,
    report,
  });
  return { feature, report };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("given the API process composes the operator back office", () => {
  describe("when the fleet is read", () => {
    /** @scenario "The operator fleet is read from the process-manager tables" */
    it("answers from the process-manager tables rather than refusing by name", async () => {
      const { queryRaw, prisma } = fleetPrisma({
        instances: [{ processName: "gateway_debits", instances: 3, overdueWakes: 1 }],
        outbox: [
          {
            processName: "gateway_debits",
            pendingMessages: 2,
            overduePending: 1,
            lapsedLeases: 0,
            deadMessages: 4,
          },
        ],
      });
      const { feature } = compose({ prisma });

      const fleet = await feature.app.getFleetSummary();

      expect(queryRaw).toHaveBeenCalledTimes(2);
      expect(fleet).toEqual([
        {
          processName: "gateway_debits",
          // This process registers no pipelines, so the row is real data the
          // registry cannot name rather than a process that vanished.
          pipelineName: "(not registered)",
          scheduled: false,
          instances: 3,
          overdueWakes: 1,
          pendingMessages: 2,
          overduePending: 1,
          lapsedLeases: 0,
          deadMessages: 4,
        },
      ]);
    });
  });

  describe("when the process holds a Redis connection", () => {
    /** @scenario "The operator dashboard reads the snapshot the writer publishes" */
    it("reads the published snapshot keys and reports no snapshot absence", async () => {
      vi.useFakeTimers();
      const redis = readingRedis();
      const { prisma } = fleetPrisma({ instances: [], outbox: [] });

      const { report } = compose({ prisma, redis: redis.connection });
      await vi.waitFor(() => expect(redis.asked.length).toBeGreaterThan(0));

      expect(redis.asked).toContain("ops:{snapshot}:live");
      expect(redis.asked).toContain("ops:{snapshot}:detail");
      expect(report.reported).not.toContain("ops-snapshot");
    });
  });

  describe("when the process holds no Redis connection", () => {
    /** @scenario "A process with no snapshot store says so rather than reporting an all-clear" */
    it("names the absence and answers the badge with no computed time", () => {
      const { prisma } = fleetPrisma({ instances: [], outbox: [] });

      const { feature, report } = compose({ prisma, redis: null });

      expect(report.reported).toContain("ops-snapshot");
      expect(feature.app.badgeCounts()).toEqual({
        blockedCount: 0,
        dlqCount: 0,
        computedAt: null,
      });
      expect(feature.app.tryGetDashboardData()).toBeNull();
    });
  });
});
