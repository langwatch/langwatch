/**
 * @vitest-environment node
 * `POST /api/v1/agents/connect/frames`: refused before the transport (ADR-128).
 * @see specs/agents/connected-agents.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerConnectEndpoints } from "../agent-connect.api";
import type { LongPollTransportService } from "../../../services/connected-agent-long-poll.service";

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  const handled = error as Error & { code?: string; httpStatus?: number };
  if (typeof handled.code === "string" && typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code, message: handled.message }, handled.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error", message: String(error) }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    c.set("project", {
      id: "project_1",
      name: "Project One",
      slug: "project-one",
      teamId: "team_1",
      organizationId: "org_1",
      isPersonal: false,
      ownerUserId: null,
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

function buildApi(relayMaxPayloadMb?: number) {
  const security = testSecurity();
  const secured = security.createProjectApp({ basePath: "/api/v1/agents" });
  const framesSpy = vi.fn();
  const fakeTransport = {
    frames: framesSpy,
    refusedAnswer: (error: unknown) => ({
      status: 422,
      body: {
        frame: { type: "refused", code: (error as { meta: { reason: string } }).meta.reason },
      },
    }),
  } as unknown as LongPollTransportService;
  registerConnectEndpoints({
    secured,
    transport: () => fakeTransport,
    relayMaxPayloadMb,
  });
  return { hono: secured.hono, framesSpy };
}

const headers = { "content-type": "application/json", authorization: "Bearer sk-lw-anything" };

describe("POST /connect/frames", () => {
  describe("when the body carries no ack, result or deregister frame", () => {
    /** @scenario "A frames body the endpoint does not take is refused as a protocol frame" */
    it("answers a refused frame with protocol_invalid", async () => {
      const { hono, framesSpy } = buildApi();

      const response = await hono.request("/api/v1/agents/connect/frames", {
        method: "POST",
        headers,
        body: JSON.stringify({ frames: [{ type: "not-a-real-frame" }] }),
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as { frame: { type: string; code: string } };
      expect(body.frame).toMatchObject({ type: "refused", code: "protocol_invalid" });
      expect(framesSpy).not.toHaveBeenCalled();
    });
  });

  describe("when the body is above the frame cap", () => {
    /** @scenario "A frames body above the cap names the limit alone" */
    it("is refused with agent_payload_too_large naming the limit and no measured size", async () => {
      // A 1 mebibyte cap, well under the oversized body below.
      const { hono, framesSpy } = buildApi(1);

      const response = await hono.request("/api/v1/agents/connect/frames", {
        method: "POST",
        headers,
        body: JSON.stringify({
          frames: [
            {
              type: "result",
              protocol: 1,
              callId: "call_1",
              output: "x".repeat(2 * 1024 * 1024),
            },
          ],
        }),
      });

      expect(response.status).toBe(413);
      const body = (await response.json()) as { error: string; message: string };
      expect(body.error).toBe("agent_payload_too_large");
      // The cap stopped the read, so the message names only the limit —
      // never a measured size, which the cap never let it weigh.
      expect(body.message).toMatch(/^The result is above the limit of \d+ bytes\.$/);
      expect(framesSpy).not.toHaveBeenCalled();
    });
  });
});
