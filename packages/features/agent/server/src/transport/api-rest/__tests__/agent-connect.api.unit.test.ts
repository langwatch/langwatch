/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { AgentService } from "@langwatch/agent-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ConnectedAgentStateAdapter } from "../../../adapters/connected-agent-state.adapter";
import type { AgentRepository } from "../../../repositories/agent.repository";
import type { ConnectCredentialPort } from "../../../ports/connect-credential.port";
import { ConnectedAgentRuntimeAdapter } from "../../../adapters/connected-agent-runtime.adapter";
import { LongPollTransportService } from "../../../services/connected-agent-long-poll.service";
import { registerConnectEndpoints } from "../agent-connect.api";

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

function buildApi({ relayMaxPayloadMb }: { relayMaxPayloadMb?: number } = {}) {
  const runtime = ConnectedAgentRuntimeAdapter.create({
    podId: "pod_solo",
    store: ConnectedAgentStateAdapter.memory(),
  });
  const transport = LongPollTransportService.create({
    runtime,
    agents: {} as AgentService,
    agentRepository: {} as AgentRepository,
    credentials: {
      resolve: async () => ({ project: { id: "proj_1", slug: "proj-one" }, userId: null }),
    } as unknown as ConnectCredentialPort,
    agentPlatformUrl: () => "https://example.test/agents",
    replicaCount: 1,
  });
  const framesSpy = vi.spyOn(transport, "frames");
  const secured = testSecurity().createProjectApp({ basePath: "/api/v1/agents" });
  registerConnectEndpoints({ secured, transport: () => transport, relayMaxPayloadMb });
  return { hono: secured.hono, framesSpy };
}

const headers = {
  "content-type": "application/json",
  authorization: "Bearer sk-lw-anything",
  "x-agent-instance-token": "ait_test",
};

describe("registerConnectEndpoints", () => {
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
