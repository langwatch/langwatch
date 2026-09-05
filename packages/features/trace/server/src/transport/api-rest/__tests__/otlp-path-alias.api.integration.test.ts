/**
 * The alias app in front of the canonical OTLP family, composed the way the
 * process composes them. What matters here is that a corrected path is served
 * — not redirected — and that it keeps every guarantee the canonical path has.
 *
 * Spec: specs/otlp/endpoint-path-canonicalisation.feature
 */
import { createAppRestSecurity, type RestApiServicePorts } from "@langwatch/api/rest";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const warnings: Array<{ fields: Record<string, unknown>; message: string }> = [];

vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: () => ({
      debug: () => undefined,
      info: () => undefined,
      error: () => undefined,
      warn: (fields: Record<string, unknown>, message?: string) => {
        warnings.push({ fields, message: message ?? "" });
      },
    }),
  };
});

const { createOtlpIngestRestApp } = await import("../otlp-ingest.api");
const { createOtlpPathAliasRestApp } = await import("../otlp-path-alias.api");

const project = { id: "project-123", teamId: "team-1", organizationId: "org-1" };

const identity = {
  apiKeyId: null,
  organizationId: "org-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
};

let credentialsAreValid = true;
const handleTraces = vi.fn(async () => ({ rejectedSpans: 0, errorMessage: "" }));
const handleLogs = vi.fn(async () => ({ outcome: "collected" as const, rejectedLogRecords: 0 }));

function testSecurity() {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: (_error, c) => c.json({ error: "Internal Server Error" }, 500),
    canonicalErrorHandler: (_error, c) => c.json({ error: "Internal Server Error" }, 500),
    authenticateProject: () => pass,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

const canonical = createOtlpIngestRestApp({
  security: testSecurity(),
  ports: {
    credential: async () =>
      credentialsAreValid
        ? { ok: true as const, project, identity, markUsed: () => undefined }
        : { ok: false as const, status: 401 as const, body: { error: "Unauthorized" } },
    usageLimit: async () => undefined,
    traces: handleTraces,
    logs: handleLogs,
  },
});

// Mount order mirrors the process: the canonical family gets first refusal.
const served = new Hono();
served.route("/", canonical);
served.route("/", createOtlpPathAliasRestApp({ canonical }));

const tracePayload = {
  resourceSpans: [
    { resource: { attributes: [] }, scopeSpans: [{ scope: { name: "t" }, spans: [] }] },
  ],
};
const logPayload = {
  resourceLogs: [
    { resource: { attributes: [] }, scopeLogs: [{ scope: { name: "t" }, logRecords: [] }] },
  ],
};

function post({ path, payload }: { path: string; payload: unknown }) {
  return served.fetch(
    new Request(`http://api.test${path}`, {
      method: "POST",
      headers: { "X-Auth-Token": "test-token", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  credentialsAreValid = true;
  warnings.length = 0;
  handleTraces.mockClear();
  handleLogs.mockClear();
});

describe("OTLP endpoint path canonicalisation", () => {
  describe("given a corrected request carrying no valid credentials", () => {
    describe("when it reaches the alias", () => {
      /** @scenario A corrected path still needs a valid key */
      it("refuses it exactly as the canonical path would", async () => {
        credentialsAreValid = false;

        const response = await post({ path: "/api/otel/v1/traces/v1/logs", payload: logPayload });

        expect(response.status).toBe(401);
        expect(handleLogs).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a corrected request the receiver accepts", () => {
    describe("when it is served", () => {
      /** @scenario A corrected path answers like the canonical one */
      it("answers with the ordinary ingestion response, not a redirect", async () => {
        const response = await post({
          path: "/api/otel/v1/traces/v1/traces",
          payload: tracePayload,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("location")).toBeNull();
        expect(await response.json()).toEqual({
          message: "Trace received successfully.",
          partialSuccess: { rejectedSpans: 0, errorMessage: "" },
        });
      });

      // Each reporting test uses a path of its own: the report is throttled per
      // (project, path) pair, and that state outlives a single request.
      /** @scenario A repeated misconfiguration is reported once a window */
      it("reports a repeated misconfiguration once, not once per batch", async () => {
        await post({ path: "/api/otel/v1/metrics/v1/logs", payload: logPayload });
        await post({ path: "/api/otel/v1/metrics/v1/logs", payload: logPayload });
        await post({ path: "/api/otel/v1/metrics/v1/logs", payload: logPayload });

        expect(handleLogs).toHaveBeenCalledTimes(3);
        const corrected = warnings.filter((w) => w.message.includes("non-canonical path"));
        expect(corrected).toHaveLength(1);
        expect(corrected[0]?.fields).toMatchObject({
          projectId: "project-123",
          originalPath: "/api/otel/v1/metrics/v1/logs",
          canonicalPath: "/api/otel/v1/logs",
        });
      });
    });
  });

  describe("given an exporter that streams its body rather than buffering it", () => {
    describe("when the path is corrected", () => {
      /** @scenario A streamed payload survives the correction */
      it("carries the streamed bytes through to ingestion", async () => {
        const streamed: RequestInit & { duplex: "half" } = {
          method: "POST",
          headers: { "X-Auth-Token": "test-token", "Content-Type": "application/json" },
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(JSON.stringify(tracePayload)));
              controller.close();
            },
          }),
          duplex: "half",
        };

        const response = await served.fetch(new Request("http://api.test/api/v1/traces", streamed));

        expect(response.status).toBe(200);
        // An empty body is refused before the handler, so reaching it at all
        // proves the bytes survived the replay.
        expect(handleTraces).toHaveBeenCalledTimes(1);
        expect(handleTraces.mock.calls[0]?.[0]).toEqual(
          expect.objectContaining({ traceRequest: expect.anything() }),
        );
      });
    });
  });
});
