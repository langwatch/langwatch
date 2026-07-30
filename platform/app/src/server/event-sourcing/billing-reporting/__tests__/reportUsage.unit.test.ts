import { describe, expect, it, vi } from "vitest";
import { type ReportUsagePorts, reportUsage } from "../reportUsage";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
  withScope: async (fn: (scope: unknown) => Promise<void>) => fn({}),
}));

const org = { id: "org-1", stripeCustomerId: "cus_1", subscriptions: [{ id: "sub_1" }] };

function makePorts(overrides: Partial<ReportUsagePorts> = {}): ReportUsagePorts {
  return {
    organizations: { getOrganizationForBilling: vi.fn().mockResolvedValue(org) },
    organizationCache: { get: vi.fn().mockResolvedValue(undefined), set: vi.fn() },
    billingCheckpoints: {
      getCheckpoint: vi.fn().mockResolvedValue(null),
      writeIntent: vi.fn(),
      confirm: vi.fn(),
      incrementFailures: vi.fn(),
      clearPendingAndIncrementFailures: vi.fn(),
    } as never,
    getUsageReportingService: () => ({
      reportUsageDelta: vi.fn().mockResolvedValue([{ reported: true }]),
    }) as never,
    queryBillableEventsTotal: vi.fn().mockResolvedValue(10),
    ...overrides,
  };
}

const payload = { organizationId: "org-1", billingMonth: "2026-07", tenantId: "org-1", occurredAt: 1_000 };

describe("reportUsage", () => {
  /** @scenario The project's organization is looked up once per cache window */
  it("reuses a cached organization rather than looking it up again", async () => {
    const getOrganizationForBilling = vi.fn().mockResolvedValue(org);
    const cache = new Map<string, typeof org>();
    const ports = makePorts({
      organizations: { getOrganizationForBilling },
      organizationCache: {
        get: async (id) => cache.get(id),
        set: async (id, value) => {
          cache.set(id, value);
        },
      },
    });

    await reportUsage(ports, payload);
    await reportUsage(ports, payload);

    expect(getOrganizationForBilling).toHaveBeenCalledTimes(1);
  });

  it("reports the delta to Stripe and confirms the checkpoint", async () => {
    const reportUsageDelta = vi.fn().mockResolvedValue([{ reported: true }]);
    const confirm = vi.fn();
    const ports = makePorts({
      getUsageReportingService: () => ({ reportUsageDelta }) as never,
      billingCheckpoints: {
        getCheckpoint: vi.fn().mockResolvedValue(null),
        writeIntent: vi.fn(),
        confirm,
        incrementFailures: vi.fn(),
        clearPendingAndIncrementFailures: vi.fn(),
      } as never,
    });

    await reportUsage(ports, payload);

    expect(reportUsageDelta).toHaveBeenCalledWith(expect.objectContaining({ stripeCustomerId: "cus_1", organizationId: "org-1" }));
    expect(confirm).toHaveBeenCalledWith({ organizationId: "org-1", billingMonth: "2026-07", lastReportedTotal: 10 });
  });

  it("skips reporting when the current total has not moved past the last report", async () => {
    const reportUsageDelta = vi.fn();
    const ports = makePorts({
      queryBillableEventsTotal: vi.fn().mockResolvedValue(5),
      billingCheckpoints: {
        getCheckpoint: vi.fn().mockResolvedValue({ lastReportedTotal: 5, consecutiveFailures: 0 }),
        writeIntent: vi.fn(),
        confirm: vi.fn(),
        incrementFailures: vi.fn(),
        clearPendingAndIncrementFailures: vi.fn(),
      } as never,
      getUsageReportingService: () => ({ reportUsageDelta }) as never,
    });

    await reportUsage(ports, payload);

    expect(reportUsageDelta).not.toHaveBeenCalled();
  });

  it("never throws to its caller, even on an unexpected failure", async () => {
    const ports = makePorts({ queryBillableEventsTotal: vi.fn().mockRejectedValue(new Error("clickhouse down")) });

    await expect(reportUsage(ports, payload)).resolves.toBeUndefined();
  });
});
