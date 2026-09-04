/**
 * What `GET /api/trace/:id` answers a customer when the read fails for a
 * reason nobody anticipated.
 *
 * The family used to render that failure itself — the internal message, the
 * absolute source paths and the stack frames, straight into the response body
 * — while its sibling `GET /api/traces/:traceId`, on the same failure in the
 * same process, degraded to the generic unknown. Finding F4 of
 * `dev/docs/plans/e2e-walk-2026-09-04.md`.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import type { TraceLegacyRestPorts, TraceLegacySearchFields } from "../trace-legacy.api";
import { createTraceLegacyRestApp } from "../trace-legacy.api";

const project = { id: "project-123" };

const INTERNAL_MESSAGE = "TraceService requires EvaluationService for evaluation reads";

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ error: serialized.code }, serialized.httpStatus as 422);
  }
  return c.json({ error: "Internal Server Error", message: "An unknown error occurred" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => pass,
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

const searchBodySchema = z.object({}).catchall(z.unknown()) as unknown as TraceLegacyRestPorts<
  TraceLegacySearchFields,
  unknown
>["searchBodySchema"];

function buildApi(readTrace: () => Promise<never>) {
  const ports: TraceLegacyRestPorts<TraceLegacySearchFields, unknown> = {
    credential: async () => ({ ok: true, project, markUsed: () => undefined }),
    traces: () => ({
      readTrace,
      readEvaluations: vi.fn(),
      listTraces: vi.fn(),
      readThreadTraces: vi.fn(),
    }),
    shares: () => ({ createShare: vi.fn(), unshare: vi.fn() }),
    getProtections: async () => ({}),
    searchBodySchema,
    describeValidationError: () => "invalid search body",
  };

  const app = createTraceLegacyRestApp({ security: testSecurity(), ports });
  return (path: string) => app.hono.fetch(new Request(`http://api.test${path}`));
}

describe("given a legacy single-trace read that fails for an unanticipated reason", () => {
  describe("when the caller asks for the trace", () => {
    /** @scenario "An unanticipated legacy trace read failure answers the generic unknown" */
    it("puts no internal message, source path or stack frame in the response body", async () => {
      const failure = new Error(INTERNAL_MESSAGE);
      failure.stack = `Error: ${INTERNAL_MESSAGE}\n    at TraceService.evaluations (/Users/someone/langwatch/packages/features/trace/server/src/services/trace-legacy-read.service.ts:711:13)`;
      const fetchTrace = buildApi(() => Promise.reject(failure));

      const response = await fetchTrace("/api/trace/trace-1");
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(body).not.toContain(INTERNAL_MESSAGE);
      expect(body).not.toContain("stack");
      expect(body).not.toContain("/Users/");
      expect(body).not.toContain(".service.ts");
    });

    /** @scenario "An unanticipated legacy trace read failure answers the generic unknown" */
    it("answers the same generic body its sibling route answers", async () => {
      const fetchTrace = buildApi(() => Promise.reject(new Error(INTERNAL_MESSAGE)));

      const response = await fetchTrace("/api/trace/trace-1");

      expect(await response.json()).toEqual({
        error: "Internal Server Error",
        message: "An unknown error occurred",
      });
    });
  });
});
