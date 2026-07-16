import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckLimit = vi.fn();
const mockHandleMetrics = vi.fn();
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();
const mockGetActivePlan = vi.fn();
const mockNotifyPlanLimitReached = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    usage: { checkLimit: mockCheckLimit },
    planProvider: { getActivePlan: mockGetActivePlan },
    usageLimits: { notifyPlanLimitReached: mockNotifyPlanLimitReached },
    traces: { metricCollection: { handleOtlpMetricRequest: mockHandleMetrics } },
  })),
}));

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({
      resolve: mockResolve,
      markUsed: mockMarkUsed,
    })),
  },
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
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
    });

    const response = await postMetrics();

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      message: "ERR_PLAN_LIMIT: monthly limit reached",
    });
    expect(mockHandleMetrics).not.toHaveBeenCalled();
  });

  it("returns OTLP partial success when some data points are rejected", async () => {
    mockHandleMetrics.mockResolvedValue({
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
});
