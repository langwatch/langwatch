/**
 * specs/otlp/endpoint-path-canonicalisation.feature — the routing.
 * The path mapping itself is covered in
 * src/server/otel/otlpPathCanonicalisation.unit.test.ts.
 */

import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckLimit = vi.fn();
const mockHandleTraces = vi.fn();
const mockHandleLogs = vi.fn();
const mockHandleMetrics = vi.fn();
const mockResolve = vi.fn();
const mockMarkUsed = vi.fn();
const mockExtractCredentials = vi.fn();
const mockWarn = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: vi.fn(() => ({
    usage: { checkLimit: mockCheckLimit },
    planProvider: {
      getActivePlan: vi.fn().mockResolvedValue({ name: "free" }),
    },
    usageLimits: { notifyPlanLimitReached: vi.fn() },
    traces: {
      collection: { handleOtlpTraceRequest: mockHandleTraces },
      logCollection: { handleOtlpLogRequest: mockHandleLogs },
      metricCollection: { handleOtlpMetricRequest: mockHandleMetrics },
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
      error: vi.fn(),
      debug: vi.fn(),
    })),
  };
});

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock("~/utils/posthogErrorCapture", () => ({ captureException: vi.fn() }));

const { app: otelApp } = await import("../otel");
const { app: otelPathAliasApp } = await import("../otel-path-aliases");
const { stampCorrectedPath } = await import(
  "~/server/otel/otlpPathCanonicalisation"
);

// Mount order mirrors api-router.ts: the canonical routes get first refusal.
const testApp = new Hono();
testApp.route("/", otelApp);
testApp.route("/", otelPathAliasApp);

const fakeProject = {
  id: "project-123",
  teamId: "team-1",
  team: { id: "team-1", organizationId: "org-1" },
};

const tracePayload = {
  resourceSpans: [
    {
      resource: { attributes: [] },
      scopeSpans: [{ scope: { name: "test" }, spans: [] }],
    },
  ],
};
const logPayload = {
  resourceLogs: [
    {
      resource: { attributes: [] },
      scopeLogs: [{ scope: { name: "test" }, logRecords: [] }],
    },
  ],
};
const metricPayload = {
  resourceMetrics: [
    {
      resource: { attributes: [] },
      scopeMetrics: [{ scope: { name: "test" }, metrics: [] }],
    },
  ],
};

function post(
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
) {
  return testApp.request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "X-Auth-Token": "test-token",
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

describe("OTLP endpoint path canonicalisation", () => {
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
    mockHandleTraces.mockResolvedValue({ rejectedSpans: 0, errorMessage: "" });
    mockHandleLogs.mockResolvedValue({
      outcome: "collected",
      rejectedLogRecords: 0,
    });
    mockHandleMetrics.mockResolvedValue({
      outcome: "collected",
      rejectedDataPoints: 0,
    });
  });

  describe("given an exporter configured with a signal URL as its base", () => {
    /** @scenario An endpoint that already named a signal */
    it("serves the doubled path as the signal the exporter appended", async () => {
      const response = await post("/api/otel/v1/traces/v1/logs", logPayload);

      expect(response.status).toBe(200);
      expect(mockHandleLogs).toHaveBeenCalledTimes(1);
    });

    /** @scenario A metrics suffix under a traces base is metric ingestion */
    it("does not serve a metrics suffix as trace ingestion", async () => {
      const response = await post(
        "/api/otel/v1/traces/v1/metrics",
        metricPayload,
      );

      expect(response.status).toBe(200);
      expect(mockHandleMetrics).toHaveBeenCalledTimes(1);
      expect(mockHandleTraces).not.toHaveBeenCalled();
    });
  });

  describe("given an exporter configured with the collector URL as its base", () => {
    /** @scenario An endpoint that named the collector */
    it("serves the collector-prefixed path as trace ingestion", async () => {
      const response = await post(
        "/api/collector/api/otel/v1/traces",
        tracePayload,
      );

      expect(response.status).toBe(200);
      expect(mockHandleTraces).toHaveBeenCalledTimes(1);
    });
  });

  describe("given an exporter configured with the site root as its base", () => {
    /** @scenario An endpoint that named the site root */
    it("serves the root-level path as trace ingestion", async () => {
      const response = await post("/v1/traces", tracePayload);

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(
        "application/json",
      );
      expect(mockHandleTraces).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a stray trailing slash on the canonical path", () => {
    /** @scenario An endpoint with a stray trailing slash */
    it("serves it as trace ingestion", async () => {
      const response = await post("/api/otel/v1/traces/", tracePayload);

      expect(response.status).toBe(200);
      expect(mockHandleTraces).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the corrected request carries no credentials", () => {
    /** @scenario A corrected path still needs a valid key */
    it("refuses it exactly as the canonical path would", async () => {
      mockExtractCredentials.mockReturnValue(void 0);

      const response = await post("/api/otel/v1/traces/v1/logs", logPayload);

      expect(response.status).toBe(401);
      expect(mockHandleLogs).not.toHaveBeenCalled();
    });
  });

  describe("when the corrected request is accepted", () => {
    /** @scenario A corrected path answers like the canonical one */
    it("answers with the ordinary ingestion response, not a redirect", async () => {
      const response = await post(
        "/api/otel/v1/traces/v1/traces",
        tracePayload,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(await response.json()).toEqual({
        message: "Trace received successfully.",
        partialSuccess: { rejectedSpans: 0, errorMessage: "" },
      });
    });

    /** @scenario The correction names the path the exporter used */
    it("records the path the exporter used and the one it was served from", async () => {
      await post("/api/otel/v1/traces/v1/logs", logPayload);

      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-123",
          originalPath: "/api/otel/v1/traces/v1/logs",
          canonicalPath: "/api/otel/v1/logs",
        }),
        expect.stringContaining("non-canonical path"),
      );
    });
  });

  describe("when a caller claims its own path was corrected", () => {
    /** @scenario A caller cannot claim its path was corrected */
    it("discards the claim", async () => {
      await post("/api/otel/v1/logs", logPayload, {
        "x-langwatch-otlp-corrected-path": "/api/otel/v1/traces/v1/logs",
      });

      expect(mockHandleLogs).toHaveBeenCalledTimes(1);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it("still reports a correction this process did make", async () => {
      const headers = new Headers();
      stampCorrectedPath({ headers, originalPath: "/v1/logs" });

      await post("/api/otel/v1/logs", logPayload, {
        "x-langwatch-otlp-corrected-path":
          headers.get("x-langwatch-otlp-corrected-path") ?? "",
      });

      expect(mockWarn).toHaveBeenCalledWith(
        expect.objectContaining({ originalPath: "/v1/logs" }),
        expect.stringContaining("non-canonical path"),
      );
    });
  });

  describe("given a path no misconfiguration produces", () => {
    /** @scenario An unrelated path that happens to end in a signal name */
    it("leaves an unrelated namespace alone", async () => {
      const response = await post("/api/rum/v1/traces", tracePayload);

      expect(response.status).toBe(404);
      expect(mockHandleTraces).not.toHaveBeenCalled();
    });

    /** @scenario A path naming something other than a signal */
    it("leaves an unknown suffix alone", async () => {
      const response = await post(
        "/api/otel/v1/traces/v1/profiles",
        tracePayload,
      );

      expect(response.status).toBe(404);
      expect(mockHandleTraces).not.toHaveBeenCalled();
    });
  });
});
