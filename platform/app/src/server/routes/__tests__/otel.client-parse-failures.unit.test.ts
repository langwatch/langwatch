/**
 * specs/otlp/client-parse-failures.feature — a malformed OTLP body is the
 * sender's mistake: 400, one client-attributed warning via handledErrorFault,
 * no error log and no PostHog exception.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckLimit = vi.fn();
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();
const mockExtractCredentials = vi.fn();
const mockWarn = vi.fn();
const mockError = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: vi.fn(() => ({
    usage: { checkLimit: mockCheckLimit },
    planProvider: {
      getActivePlan: vi.fn().mockResolvedValue({ name: "free" }),
    },
    usageLimits: { notifyPlanLimitReached: vi.fn() },
    traces: {
      collection: { handleOtlpTraceRequest: vi.fn() },
      logCollection: { handleOtlpLogRequest: vi.fn() },
      metricCollection: { handleOtlpMetricRequest: vi.fn() },
    },
  })),
}));

vi.mock("~/server/api-key/token-resolver", () => ({
  TokenResolver: {
    create: vi.fn(() => ({ resolve: mockResolve, markUsed: mockMarkUsed })),
  },
}));

vi.mock("~/server/api-key/auth-middleware", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/server/api-key/auth-middleware")>();
  return {
    ...actual,
    extractCredentials: mockExtractCredentials,
    enforceApiKeyCeiling: vi.fn().mockResolvedValue(void 0),
  };
});

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      warn: mockWarn,
      info: vi.fn(),
      error: mockError,
      debug: vi.fn(),
    })),
  };
});

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/utils/posthogErrorCapture", () => ({ captureException: vi.fn() }));

const { app: otelApp } = await import("../otel");
const { captureException } = await import("~/utils/posthogErrorCapture");

const fakeProject = {
  id: "project-123",
  teamId: "team-1",
  team: { id: "team-1", organizationId: "org-1" },
};

function postMalformed({ path }: { path: string }) {
  return otelApp.request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
    },
    body: "{not json",
  });
}

const signals = [
  {
    signal: "traces",
    path: "/api/otel/v1/traces",
  },
  {
    signal: "logs",
    path: "/api/otel/v1/logs",
  },
  {
    signal: "metrics",
    path: "/api/otel/v1/metrics",
  },
] as const;

describe("OTLP parse failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractCredentials.mockReturnValue({
      token: "test-token",
      projectId: "project-123",
    });
    mockResolve.mockResolvedValue({
      type: "legacyProjectKey",
      project: fakeProject,
    });
    mockCheckLimit.mockResolvedValue({ exceeded: false });
  });

  describe.each(signals)("given the $signal endpoint", ({ signal, path }) => {
    describe("when the body is malformed", () => {
      /** @scenario "A malformed traces body is treated as the client's error" */
      /** @scenario "A malformed logs body is treated as the client's error" */
      /** @scenario "A malformed metrics body is treated as the client's error" */
      it("answers 400 with the parse failure", async () => {
        const response = await postMalformed({ path });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
          error: `Failed to parse ${signal}`,
        });
      });

      it("logs exactly one parse warning attributed to the client and project", async () => {
        await postMalformed({ path });

        // The request logger also warns "request handled" for every 4xx; count only the parse warning.
        const parseWarnings = mockWarn.mock.calls.filter(
          ([, message]) => message === `error parsing ${signal}`,
        );
        expect(parseWarnings).toHaveLength(1);
        expect(mockWarn).toHaveBeenCalledWith(
          expect.objectContaining({
            handledErrorFault: "customer",
            projectId: "project-123",
          }),
          `error parsing ${signal}`,
        );
      });

      it("logs no error", async () => {
        await postMalformed({ path });

        expect(mockError).not.toHaveBeenCalled();
      });

      it("reports no exception", async () => {
        await postMalformed({ path });

        expect(captureException).not.toHaveBeenCalled();
      });
    });
  });
});
