import { describe, expect, it, vi } from "vitest";
import { AutomationEmailCapService } from "@langwatch/automation-server";
import { buildAutomationDispatchPorts } from "../../automation-dispatch.wiring";

vi.mock("~/env.mjs", () => ({
  env: {
    BASE_HOST: "https://app.example.com",
    TRIGGER_EMAIL_HOURLY_CAP: 100,
    TRIGGER_EMAIL_TENANT_DAILY_CAP: 1_000,
  },
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

describe("automation dispatch wiring smoke", () => {
  describe("when the composition root builds worker ports", () => {
    it("connects settlement delivery", () => {
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
        emailCaps: AutomationEmailCapService.create({ store: null }),
        automation: {
          ...triggers,
          filterSuppressed: vi.fn(async ({ emails }) => emails),
          recordWebhookDelivery: vi.fn().mockResolvedValue(undefined),
          tryGetCustomGraph: vi.fn().mockResolvedValue(null),
        } as never,
        projects: {} as never,
        evaluations: {} as never,
        traces: { canonicalisation: {} as never, tree: {} as never },
        dataset: {} as never,
        annotations: {} as never,
        baseHost: "https://app.example.com",
        emailHourlyCap: 100,
        tenantDailyCap: 1_000,
      });

      expect(ports.settlement).toEqual(
        expect.objectContaining({
          notifyDigest: expect.any(Function),
          persistMatch: expect.any(Function),
          logOverflow: expect.any(Function),
        }),
      );
    });
  });
});
