/**
 * `GET /api/traces/:traceId` handed the truncated id the CLI's `trace search`
 * prints: the prefix reaches the read unaltered and the answer carries the
 * FULL id. See packages/features/trace/specs/partial-trace-id-resolution.feature.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { Trace } from "@langwatch/trace-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  createTracesRestApp,
  traceSearchBodyExtensions,
  type TraceSearchBody,
  type TracesRestPorts,
} from "../traces.api.ts";

/** What `langwatch trace search --limit 1` prints, and the trace behind it. */
const DISPLAYED_PREFIX = "63dc535cea6335c506bc";
const FULL_TRACE_ID = "63dc535cea6335c506bc81ef3543a07d";

const project = {
  id: "project-123",
  name: "Project 123",
  slug: "project-123",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();
    return c.json({ error: serialized.code }, serialized.httpStatus as 422);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  // The whole resolved credential, as the process's own authentication
  // installs it: handlers read their caller off this, never off loose keys.
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", project);
    c.set("resolvedToken", {
      type: "apiKey",
      apiKeyId: "key-1",
      userId: "user-1",
      organizationId: "organization-1",
      ingestSourceType: null,
      ingestionTemplateId: null,
      project,
    });
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
    authorizeRouteTeamPermission: () => pass,
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
    ...traceSearchBodyExtensions,
  })
  .catchall(z.unknown()) as unknown as TracesRestPorts<
  TraceSearchBody,
  unknown
>["searchBodySchema"];

function buildApi() {
  // The read resolves the prefix and hands back the trace under its full id,
  // which is the service's contract.
  const tryGetById = vi.fn(
    async () =>
      ({
        trace_id: FULL_TRACE_ID,
        project_id: project.id,
        input: { value: "What is AI?" },
        output: { value: "AI is artificial intelligence." },
        timestamps: { started_at: 1000, inserted_at: 2000, updated_at: 2000 },
        spans: [],
      }) as unknown as Trace,
  );
  const getEvaluationsMultiple = vi.fn(async () => ({ [FULL_TRACE_ID]: [] }));

  const ports: TracesRestPorts<TraceSearchBody, unknown> = {
    searchBodySchema,
    traces: () => ({
      getAllTracesForProject: vi.fn(),
      tryGetById,
      getEvaluationsMultiple,
    }),
    getProtections: vi.fn().mockResolvedValue({}),
    platformUrl: ({ projectSlug, path }) => `https://app.test/${projectSlug}${path}`,
  };

  const app = createTracesRestApp({ security: testSecurity(), ports });
  return {
    tryGetById,
    getEvaluationsMultiple,
    fetch: (path: string) => app.fetch(new Request(`http://api.test${path}`)),
  };
}

describe("given the trace id a CLI `trace search` displayed is a truncation", () => {
  describe("when `trace get` asks for that id", () => {
    /** @scenario CLI `trace get` with truncated ID from `trace search` succeeds */
    it("answers with the full trace, so the printed details name the real trace", async () => {
      const api = buildApi();

      const response = await api.fetch(`/api/traces/${DISPLAYED_PREFIX}`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { trace_id: string; platformUrl?: string };
      expect(body.trace_id).toBe(FULL_TRACE_ID);
      expect(body.platformUrl).toContain(FULL_TRACE_ID);
      // The door passes the prefix through rather than padding or rejecting it,
      // and everything downstream of the resolution keys on the full id.
      expect(api.tryGetById).toHaveBeenCalledWith(
        project.id,
        DISPLAYED_PREFIX,
        expect.anything(),
        expect.anything(),
      );
      expect(api.getEvaluationsMultiple).toHaveBeenCalledWith(
        project.id,
        [FULL_TRACE_ID],
        expect.anything(),
      );
    });
  });
});
