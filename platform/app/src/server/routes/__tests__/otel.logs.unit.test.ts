import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckLimit = vi.fn();
const mockHandleLogs = vi.fn();
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();
const mockGetActivePlan = vi.fn();
const mockNotifyPlanLimitReached = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    usage: { checkLimit: mockCheckLimit },
    planProvider: { getActivePlan: mockGetActivePlan },
    usageLimits: { notifyPlanLimitReached: mockNotifyPlanLimitReached },
    traces: { logCollection: { handleOtlpLogRequest: mockHandleLogs } },
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
      });

      const response = await postLogs();

      expect(response.status).toBe(429);
      expect(mockHandleLogs).not.toHaveBeenCalled();
    });
  });
});
