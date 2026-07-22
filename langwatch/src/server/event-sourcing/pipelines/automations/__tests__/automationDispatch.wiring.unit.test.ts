import { describe, expect, it, vi } from "vitest";
import { buildAutomationDispatchPorts } from "../automationDispatch.wiring";

const {
  decideGraphTriggerHeartbeatMock,
  evaluateGraphTriggerMock,
  filterSuppressedMock,
  pruneExpiredMock,
} = vi.hoisted(() => ({
  decideGraphTriggerHeartbeatMock: vi.fn().mockResolvedValue([]),
  evaluateGraphTriggerMock: vi.fn().mockResolvedValue(undefined),
  filterSuppressedMock: vi.fn(
    async ({ emails }: { emails: string[] }) => emails,
  ),
  pruneExpiredMock: vi.fn().mockResolvedValue(7),
}));

vi.mock("~/env.mjs", () => ({
  env: {
    BASE_HOST: "https://app.example.com",
    TRIGGER_EMAIL_HOURLY_CAP: 100,
    TRIGGER_EMAIL_TENANT_DAILY_CAP: 1_000,
  },
}));

vi.mock("~/server/app-layer/automations/graph-trigger-evaluation.service", () => ({
  evaluateGraphTrigger: evaluateGraphTriggerMock,
}));

vi.mock("~/server/app-layer/automations/graph-trigger-heartbeat", () => ({
  decideGraphTriggerHeartbeat: decideGraphTriggerHeartbeatMock,
  defaultCandidateSources: vi.fn(() => ({ sources: true })),
  defaultGraphTriggerHeartbeatDeps: vi.fn(() => ({ deps: true })),
}));

vi.mock("~/server/app-layer/traces/trace-read-derivation.service", () => ({
  TraceReadDerivationService: class {
    deriveEvents = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("~/server/traces/trace.service", () => ({
  TraceService: {
    create: vi.fn(() => ({ getById: vi.fn().mockResolvedValue(undefined) })),
  },
}));

vi.mock("~/server/api/utils", () => ({
  getProtectionsForProject: vi.fn().mockResolvedValue({}),
}));

vi.mock("@langwatch/automations-server/services/webhook-delivery.service", () => ({
  WebhookDeliveryService: vi.fn(function () {
    return {
      record: vi.fn().mockResolvedValue(undefined),
      pruneExpired: pruneExpiredMock,
    };
  }),
}));

vi.mock("~/server/app-layer/automations/dispatch/emailCaps", () => ({
  consumeEmailCapSlot: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
  consumeTenantEmailCapSlot: vi
    .fn()
    .mockResolvedValue({ allowed: true, count: 1 }),
}));

describe("automation dispatch wiring smoke", () => {
  describe("when the composition root builds worker ports", () => {
    it("connects settlement delivery and graph-sweep entry points", async () => {
      const triggers = {
        updateLastRunAt: vi.fn().mockResolvedValue(undefined),
        isSendClaimed: vi.fn().mockResolvedValue(false),
        claimSend: vi.fn().mockResolvedValue(undefined),
      };
      const prisma = {
        trigger: { findUnique: vi.fn() },
        customGraph: { findUnique: vi.fn() },
        project: { findUnique: vi.fn() },
      };
      const ports = buildAutomationDispatchPorts({
        prisma: prisma as never,
        redis: null,
        triggers: triggers as never,
        emailSuppressions: { filterSuppressed: filterSuppressedMock } as never,
        projects: {} as never,
        evaluations: { runs: {} as never },
        traces: { spans: {} as never },
        traceSummaryRepository: {} as never,
      });

      expect(ports.settlementDeps).toEqual(
        expect.objectContaining({
          triggers,
          baseHost: "https://app.example.com",
          emailHourlyCap: 100,
          tenantDailyCap: 1_000,
          traceSummaryStore: expect.any(Object),
          recordWebhookDelivery: expect.any(Function),
        }),
      );

      await ports.settlementDeps.filterSuppressedEmails({
        projectId: "project-1",
        triggerId: "trigger-1",
        emails: ["ops@example.com"],
      });
      expect(filterSuppressedMock).toHaveBeenCalledWith({
        projectId: "project-1",
        triggerId: "trigger-1",
        emails: ["ops@example.com"],
      });

      await ports.evaluateGraphTrigger({
        triggerId: "trigger-1",
        projectId: "project-1",
        reason: "heartbeat-absence",
      });
      expect(evaluateGraphTriggerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          triggerId: "trigger-1",
          projectId: "project-1",
          reason: "heartbeat-absence",
          deps: expect.any(Object),
        }),
      );

      const now = new Date("2026-07-18T12:00:00.000Z");
      await ports.decideSweepCandidates({ now });
      expect(decideGraphTriggerHeartbeatMock).toHaveBeenCalledWith({
        deps: { deps: true },
        sources: { sources: true },
        now,
      });

      await expect(ports.pruneWebhookDeliveries()).resolves.toBe(7);
      expect(pruneExpiredMock).toHaveBeenCalledTimes(1);
    });
  });
});
