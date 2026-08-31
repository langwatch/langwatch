import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";

const mockCheckLimit = vi.fn();
const mockHandleMetrics = vi.fn();
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();
const mockGetActivePlan = vi.fn();
const mockNotifyPlanLimitReached = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: vi.fn(() => ({
    // Resolving an inbound credential is the api-key SERVICE's job, and the
    // App hands that service out through `ApiKeyApp.apiKeyService` — the seam
    // every key-authenticated route reads on the way in.
    apiKeys: {
      apiKeyService: {
        tryResolveToken: mockResolve,
        markUsed: mockMarkUsed,
      },
    },
    usage: { checkLimit: mockCheckLimit },
    planProvider: { getActivePlan: mockGetActivePlan },
    usageLimits: { notifyPlanLimitReached: mockNotifyPlanLimitReached },
    // `applyReceiverProvenance*` is handed `c.app.governance` itself as its
    // policy, so the service's methods sit at the top of this facet.
    governance: { resolveSourceNonBillable: vi.fn().mockResolvedValue(false) },
    // Ingestion is NOT on `TraceApp`: the App names the span/log/metric
    // collection services apart as `traceIngestion`, which is what every OTLP
    // and collector handler reads.
    traceIngestion: {
      metricCollection: { handleOtlpMetricRequest: mockHandleMetrics },
    },
  })),
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: vi.fn(() => ({
      token: "test-token",
      projectId: "project-123",
    })),
    enforceApiKeyCeiling: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

const { app: otelApp } = await import("../otel");
const testApp = new Hono();
testApp.use("*", appContextMiddlewareFor(getApp()));
testApp.route("/", otelApp);

const fakeProject = {
  id: "project-123",
  teamId: "team-1",
  team: { id: "team-1", organizationId: "org-1" },
};

const metricPayload = {
  resourceMetrics: [
    {
      resource: { attributes: [] },
      scopeMetrics: [
        {
          scope: { name: "test" },
          metrics: [
            {
              name: "test.metric",
              gauge: {
                dataPoints: [
                  {
                    timeUnixNano: "1700000000000000000",
                    asDouble: 1.5,
                    attributes: [],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

function postMetrics() {
  return testApp.request("http://localhost/api/otel/v1/metrics", {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(metricPayload),
  });
}

describe("POST /api/otel/v1/metrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });
    mockCheckLimit.mockResolvedValue({ exceeded: false });
    mockGetActivePlan.mockResolvedValue({ name: "free" });
    mockNotifyPlanLimitReached.mockResolvedValue(undefined);
    mockHandleMetrics.mockResolvedValue({
      outcome: "collected",
      acceptedDataPoints: 1,
      rejectedDataPoints: 0,
    });
  });

  it("enforces the project plan limit before accepting metrics", async () => {
    mockCheckLimit.mockResolvedValue({
      exceeded: true,
      message: "monthly limit reached",
      planName: "free",
      count: 10,
      maxMessagesPerMonth: 10,
      usageUnit: "traces",
    });

    const response = await postMetrics();

    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "ERR_PLAN_LIMIT",
      message: "monthly limit reached",
      currentMonthMessagesCount: 10,
      maxMessagesPerMonth: 10,
      activePlanName: "free",
    });
    expect(mockHandleMetrics).not.toHaveBeenCalled();
  });

  it("tells the plan limit notifier which cap was hit", async () => {
    mockCheckLimit.mockResolvedValue({
      exceeded: true,
      message: "monthly limit reached",
      planName: "free",
      count: 12000,
      maxMessagesPerMonth: 10000,
      usageUnit: "events",
    });

    await postMetrics();

    expect(mockNotifyPlanLimitReached).toHaveBeenCalledWith(
      expect.objectContaining({
        planName: "free",
        usageUnit: "events",
        current: 12000,
        max: 10000,
      }),
    );
  });

  it("returns OTLP partial success when some data points are rejected", async () => {
    mockHandleMetrics.mockResolvedValue({
      outcome: "collected",
      acceptedDataPoints: 1,
      rejectedDataPoints: 2,
      errorMessage: "two malformed points",
    });

    const response = await postMetrics();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      partialSuccess: {
        rejectedDataPoints: 2,
        errorMessage: "two malformed points",
      },
    });
    expect(mockHandleMetrics).toHaveBeenCalledOnce();
  });

  describe("when the batch could not be persisted", () => {
    it("answers with a retryable status instead of a partial success", async () => {
      mockHandleMetrics.mockResolvedValue({
        outcome: "unavailable",
        errorMessage: "failed to record data point",
      });

      const response = await postMetrics();
      const body = await response.json();

      // OTLP reads 200 + partialSuccess as "permanently rejected, do not
      // retry". Answering that on our own queue outage makes every collector
      // drop its buffer, so the batch has to come back as retryable instead.
      expect(response.status).toBe(503);
      expect(body).not.toHaveProperty("partialSuccess");
    });
  });
});
