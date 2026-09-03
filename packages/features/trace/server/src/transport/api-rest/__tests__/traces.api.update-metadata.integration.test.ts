/**
 * `PATCH /api/traces/:traceId/metadata`, through the real Hono route family —
 * the reserved-field split (`user_id`/`customer_id`/`thread_id`/`labels` vs.
 * free-form custom keys) and the request-body validation `traceMetadataUpdateSchema`
 * enforces.
 *
 * Was
 * `platform/app/src/app/api/traces/[[...route]]/__tests__/update-metadata.unit.test.ts`,
 * against the route's own `app.v1.ts`. The route now lives in this package as
 * `createTracesRestApp`; the reserved/custom split now lives in
 * `updateTraceMetadata` (`#services/trace-metadata-write.service`), so this
 * test mounts the real route with `updateTraceMetadata` as the port and
 * asserts on what it was called with, mirroring the way the search-projection
 * integration test mocks its own boundaries.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { TraceSearchBody, TracesRestPorts } from "../traces.api";
import { createTracesRestApp } from "../traces.api";

const mockUpdateTraceMetadata = vi.fn().mockResolvedValue(undefined);

const project = {
  id: "project-123",
  name: "Project 123",
  slug: "test-project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json(
      { error: serialized.code, reasons: serialized.reasons },
      serialized.httpStatus as 422,
    );
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    await next();
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };

  return createAppRestSecurity(ports);
}

const searchBodySchema = z
  .object({
    startDate: z.union([z.string(), z.number()]),
    endDate: z.union([z.string(), z.number()]),
    pageSize: z.number().optional(),
  })
  .catchall(z.unknown()) as unknown as TracesRestPorts<TraceSearchBody, unknown>["searchBodySchema"];

function buildApi() {
  const ports: TracesRestPorts<TraceSearchBody, unknown> = {
    searchBodySchema,
    traces: () => ({
      getAllTracesForProject: vi.fn(),
      getById: vi.fn(),
      getEvaluationsMultiple: vi.fn(),
    }),
    getProtections: vi.fn().mockResolvedValue({}),
    platformUrl: ({ projectSlug, path }) => `https://app.test/${projectSlug}${path}`,
    updateTraceMetadata: mockUpdateTraceMetadata,
  };

  const app = createTracesRestApp({ security: testSecurity(), ports });

  return {
    fetch: (path: string, init?: RequestInit) => app.hono.fetch(new Request(`http://api.test${path}`, init)),
  };
}

function patchMetadata(api: ReturnType<typeof buildApi>, traceId: string, metadata: Record<string, unknown>) {
  return api.fetch(`/api/traces/${traceId}/metadata`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metadata }),
  });
}

describe("given PATCH /api/traces/:traceId/metadata", () => {
  beforeEach(() => {
    mockUpdateTraceMetadata.mockClear();
  });

  describe("when called with valid reserved metadata", () => {
    /** @scenario PATCH endpoint injects a synthetic span with metadata as resource attributes */
    it("calls updateTraceMetadata with the reserved fields split out", async () => {
      const api = buildApi();
      const res = await patchMetadata(api, "trace-abc", {
        user_id: "new-user",
        labels: ["qa"],
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { traceId: string };
      expect(body.traceId).toBe("trace-abc");

      expect(mockUpdateTraceMetadata).toHaveBeenCalledOnce();
      const call = mockUpdateTraceMetadata.mock.calls[0]![0];
      expect(call.projectId).toBe("project-123");
      expect(call.traceId).toBe("trace-abc");
      expect(call.metadata).toEqual({ user_id: "new-user", labels: ["qa"] });
    });
  });

  describe("when called with an empty metadata object", () => {
    /** @scenario PATCH endpoint rejects empty metadata object */
    it("returns 422", async () => {
      const api = buildApi();
      const res = await patchMetadata(api, "trace-abc", {});
      expect(res.status).toBe(422);
      expect(mockUpdateTraceMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when called with an oversized metadata value", () => {
    /** @scenario PATCH endpoint rejects oversized metadata values */
    it("returns 422 for values exceeding 4KB", async () => {
      const api = buildApi();
      const res = await patchMetadata(api, "trace-abc", {
        big_value: "x".repeat(4097),
      });
      expect(res.status).toBe(422);
      expect(mockUpdateTraceMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when called with all reserved fields", () => {
    /** @scenario PATCH endpoint maps reserved fields to resource attributes */
    it("passes user_id, customer_id, thread_id through as reserved metadata", async () => {
      const api = buildApi();
      const res = await patchMetadata(api, "trace-abc", {
        user_id: "u1",
        customer_id: "c1",
        thread_id: "t1",
      });

      expect(res.status).toBe(200);
      const call = mockUpdateTraceMetadata.mock.calls[0]![0];
      expect(call.metadata).toEqual({ user_id: "u1", customer_id: "c1", thread_id: "t1" });
    });
  });

  describe("when called with custom metadata keys", () => {
    /** @scenario "PATCH endpoint maps custom keys to langwatch.metadata.* resource attributes" */
    it("passes custom keys through untouched for the service to prefix", async () => {
      const api = buildApi();
      const res = await patchMetadata(api, "trace-abc", {
        environment: "staging",
      });

      expect(res.status).toBe(200);
      const call = mockUpdateTraceMetadata.mock.calls[0]![0];
      expect(call.metadata).toEqual({ environment: "staging" });
    });
  });
});
