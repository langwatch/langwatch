import { createApiFixture } from "@langwatch/test-harness/api-fixture";
/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { AgentApi } from "@langwatch/agent-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
const outputLog = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@langwatch/observability", async (original) => {
  const actual = await original<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name === "langwatch:api:json-protocol")
        vi.spyOn(logger, "error").mockImplementation(outputLog.error);
      return logger;
    },
  };
});
import { registerConnectEndpoints } from "../agent-connect.rest.ts";

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  const handled = error as Error & { code?: string; httpStatus?: number };
  if (typeof handled.code === "string" && typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code, message: handled.message }, handled.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error", message: "Internal server error" }, 500);
};

function testSecurity(): AppRestSecurity {
  const passthrough: MiddlewareHandler = async (_c, next) => next();
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => passthrough,
    authorizeProjectPermission: () => passthrough,
    authorizeApiKeyCeiling: () => passthrough,
    authenticateOrganization: () => passthrough,
    authorizeOrganizationPermission: () => passthrough,
    authorizeRouteTeamPermission: () => passthrough,
    authorizeRouteProjectPermission: () => passthrough,
    authenticateOrganizationThrowing: async () => undefined,
    authorizeOrganizationPermissionThrowing: () => async () => undefined,
  };
  return createAppRestSecurity(ports);
}

function buildApi({
  relayMaxPayloadMb,
  application,
}: { relayMaxPayloadMb?: number; application?: AgentApi } = {}) {
  const framesSpy = vi.fn(async () => ({ accepted: 1 }));
  const app = application ?? createApiFixture<AgentApi>({ connectFrames: framesSpy });
  const family = testSecurity().createProjectVersionedApp({
    name: "agents-v1",
    basePath: "/api/v1/agents",
    errorEnvelope: "legacy",
    staticGeneration: "v1",
  });
  registerConnectEndpoints({ family, app: () => app, relayMaxPayloadMb });
  return { hono: family.service.build(), framesSpy };
}

const headers = {
  "content-type": "application/json",
  authorization: "Bearer sk-lw-anything",
  "x-agent-instance-token": "ait_test",
};

describe("registerConnectEndpoints", () => {
  it.each([
    ["api_key_invalid", 401],
    ["project_required", 400],
    ["permission_denied", 403],
    ["key_type_not_allowed", 403],
    ["replica_count_unsupported", 503],
    ["parameters_invalid", 422],
    ["environment_invalid", 422],
    ["protocol_invalid", 422],
  ] as const)("maps the %s refusal to HTTP %i", async (code, status) => {
    const app = createApiFixture<AgentApi>({
      connectRegister: async () => ({
        frame: { type: "refused", protocol: 1, code, message: "Refused" },
      }),
    });
    const { hono } = buildApi({ application: app });

    const response = await hono.request("/api/v1/agents/connect/register", {
      method: "POST",
      headers,
      body: "{}",
    });

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      frame: { type: "refused", protocol: 1, code, message: "Refused" },
    });
  });

  it("answers a registered frame and instance token with HTTP 200", async () => {
    const answer = {
      frame: {
        type: "registered" as const,
        protocol: 1 as const,
        agents: [],
        heartbeatIntervalMs: 1000,
        instanceId: "instance_one",
      },
      instanceToken: "token_one",
    };
    const { hono } = buildApi({
      application: createApiFixture<AgentApi>({ connectRegister: async () => answer }),
    });

    const response = await hono.request("/api/v1/agents/connect/register", {
      method: "POST",
      headers,
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(answer);
  });

  it("passes only parsed protocol input and declared credential facts", async () => {
    const connectFrames = vi.fn(async () => ({ accepted: 1 }));
    const { hono } = buildApi({ application: createApiFixture<AgentApi>({ connectFrames }) });
    const frame = { type: "ack", protocol: 1, callId: "call_one" };

    const response = await hono.request("/api/v1/agents/connect/frames", {
      method: "POST",
      headers: { ...headers, "x-unrelated-secret": "do-not-forward" },
      body: JSON.stringify({ frames: [frame], extra: "discard" }),
    });

    expect(response.status).toBe(200);
    expect(connectFrames).toHaveBeenCalledExactlyOnceWith(
      { frames: [frame] },
      { authorization: headers.authorization, instanceToken: "ait_test" },
    );
  });

  it("preserves malformed output while logging validation metadata without content", async () => {
    const app = createApiFixture<AgentApi>();
    const secret = "private-response-marker";
    Object.defineProperty(app, "connectFrames", { value: async () => ({ accepted: secret }) });
    const { hono } = buildApi({ application: app });
    outputLog.error.mockClear();

    const response = await hono.request("/api/v1/agents/connect/frames", {
      method: "POST",
      headers,
      body: JSON.stringify({ frames: [{ type: "ack", protocol: 1, callId: "call_one" }] }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: secret });
    expect(outputLog.error).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: "postConnectedAgentFrames",
        method: "post",
        validation: expect.any(Object),
      }),
      "Protocol response did not match its declared output schema",
    );
    expect(JSON.stringify(outputLog.error.mock.calls)).not.toContain(secret);
  });

  describe("given an instance registered over HTTP", () => {
    describe("when it posts a body that carries no ack, result or deregister frame", () => {
      /** @scenario "A frames body the endpoint does not take is refused as a protocol frame" */
      it("answers a refused frame with protocol_invalid", async () => {
        const { hono, framesSpy } = buildApi();

        const response = await hono.request("/api/v1/agents/connect/frames", {
          method: "POST",
          headers,
          body: JSON.stringify({ frames: [{ type: "ping" }] }),
        });
        const body = (await response.json()) as { frame?: { code?: string } };

        expect(body.frame?.code).toBe("protocol_invalid");
        expect(framesSpy).not.toHaveBeenCalled();
      });
    });

    describe("when it posts a body above the frame cap", () => {
      /** @scenario "A frames body above the cap names the limit alone" */
      it("is refused with agent_payload_too_large, naming the limit and no measured size", async () => {
        const { hono, framesSpy } = buildApi({ relayMaxPayloadMb: 0.001 });
        const oversized = "x".repeat(64 * 1024);

        const response = await hono.request("/api/v1/agents/connect/frames", {
          method: "POST",
          headers,
          body: JSON.stringify({
            frames: [{ type: "result", protocol: 1, callId: "call_1", output: oversized }],
          }),
        });
        const body = (await response.json()) as {
          error?: string;
          message?: string;
        };

        expect(body.error).toBe("agent_payload_too_large");
        expect(body.message).toMatch(/limit of 2096 bytes/);
        expect(body.message).not.toContain(String(oversized.length));
        expect(framesSpy).not.toHaveBeenCalled();
      });
    });
  });
});
