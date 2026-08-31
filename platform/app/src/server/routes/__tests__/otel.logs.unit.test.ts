import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appContextMiddlewareFor } from "~/app/api/middleware/app-context";
import { getApp } from "~/server/app-layer/app";

const mockCheckLimit = vi.fn();
const mockHandleLogs = vi.fn();
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
    traceIngestion: { logCollection: { handleOtlpLogRequest: mockHandleLogs } },
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

const logPayload = {
  resourceLogs: [
    {
      resource: { attributes: [] },
      scopeLogs: [
        {
          scope: { name: "test" },
          logRecords: [
            {
              timeUnixNano: "1700000000000000000",
              severityNumber: 9,
              severityText: "INFO",
              body: { stringValue: "hello" },
              attributes: [],
            },
          ],
        },
      ],
    },
  ],
};

function postLogs() {
  return testApp.request("http://localhost/api/otel/v1/logs", {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(logPayload),
  });
}

describe("POST /api/otel/v1/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });
    mockCheckLimit.mockResolvedValue({ exceeded: false });
    mockGetActivePlan.mockResolvedValue({ name: "free" });
    mockNotifyPlanLimitReached.mockResolvedValue(undefined);
    mockHandleLogs.mockResolvedValue({
      outcome: "collected",
      acceptedLogRecords: 1,
      rejectedLogRecords: 0,
    });
  });

  describe("when every record is accepted", () => {
    it("answers without a rejection envelope", async () => {
      const response = await postLogs();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
    });
  });

  describe("when the sender's own records are malformed", () => {
    it("returns OTLP partial success naming the rejected count", async () => {
      mockHandleLogs.mockResolvedValue({
        outcome: "collected",
        acceptedLogRecords: 1,
        rejectedLogRecords: 2,
        errorMessage: "two malformed records",
      });

      const response = await postLogs();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        partialSuccess: {
          rejectedLogRecords: 2,
          errorMessage: "two malformed records",
        },
      });
    });
  });

  describe("when the batch could not be persisted", () => {
    it("answers with a retryable status instead of a partial success", async () => {
      mockHandleLogs.mockResolvedValue({
        outcome: "unavailable",
        errorMessage: "failed to record log batch",
      });

      const response = await postLogs();
      const body = await response.json();

      // OTLP reads 200 + partialSuccess as "permanently rejected, do not
      // retry". Answering that on our own queue outage makes every collector
      // drop its buffer, so the batch has to come back as retryable instead.
      expect(response.status).toBe(503);
      expect(body).not.toHaveProperty("partialSuccess");
    });

    it("does not disclose internal failure detail to the sender", async () => {
      mockHandleLogs.mockResolvedValue({
        outcome: "unavailable",
        errorMessage: "log ingestion is temporarily unavailable",
      });

      const response = await postLogs();

      expect(await response.json()).toEqual({
        error: "log ingestion is temporarily unavailable",
      });
    });
  });

  describe("when the project is over its plan limit", () => {
    it("rejects the batch before it reaches the collection service", async () => {
      mockCheckLimit.mockResolvedValue({
        exceeded: true,
        message: "monthly limit reached",
        planName: "free",
        count: 10,
        maxMessagesPerMonth: 10,
        usageUnit: "traces",
      });

      const response = await postLogs();

      expect(response.status).toBe(402);
      expect(mockHandleLogs).not.toHaveBeenCalled();
    });
  });
});
