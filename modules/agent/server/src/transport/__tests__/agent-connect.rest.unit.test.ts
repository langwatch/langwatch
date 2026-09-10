/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  bindRestMiddleware,
  createRestRuntime,
  type RestCaller,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { AgentApi, AgentConnectRegisterAnswer } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { agentConnectHeaders, createAgentConnectRest } from "../agent-connect.rest.ts";
import { agentRestErrorHandler } from "../agent.rest.ts";

const outputLog = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@langwatch/observability", async (original) => {
  const actual = await original<typeof import("@langwatch/observability")>();
  return {
    ...actual,
    createLogger: (name: string) => {
      const logger = actual.createLogger(name);
      if (name.startsWith("langwatch:api")) vi.spyOn(logger, "error").mockImplementation(outputLog.error);
      return logger;
    },
  };
});

const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message, ...error.meta },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  return c.json({ error: "internal_server_error", message: "Internal server error" }, 500);
};

function buildApi({
  relayMaxPayloadMb,
  application,
}: { relayMaxPayloadMb?: number; application?: AgentApi } = {}) {
  const framesSpy = vi.fn(async () => ({ accepted: 1 }));
  const app = application ?? createApiFixture<AgentApi>({ connectFrames: framesSpy });
  const runtime = createRestRuntime({
    identity: { authenticate: (): RestCaller => ({ actor: null, scope: null }) },
  } as never);
  const hono = new Hono();
  hono.route(
    "/",
    runtime.mount(createAgentConnectRest(relayMaxPayloadMb).router(), {
      app: () => app,
      onError: agentRestErrorHandler(renderRefusal),
      facts: [
        bindRestMiddleware(agentConnectHeaders, (context) => ({
          authorization: context.req.header("authorization"),
          projectId: context.req.header("x-project-id"),
          instanceToken: context.req.header("x-agent-instance-token"),
        })),
      ],
    }),
  );
  return {
    hono: { request: (path: string, init?: RequestInit) => hono.request(`http://api.test${path}`, init) },
    framesSpy,
  };
}

const headers = {
  "content-type": "application/json",
  authorization: "Bearer sk-lw-anything",
  "x-agent-instance-token": "ait_test",
};

describe("registerConnectedAgentInstance", () => {
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
    const refusedFrame = { type: "refused" as const, protocol: 1 as const, code, message: "Refused" };
    const app = createApiFixture<AgentApi>({
      connectRegister: async (): Promise<AgentConnectRegisterAnswer> => ({ frame: refusedFrame }),
    });
    const { hono } = buildApi({ application: app });

    const response = await hono.request("/api/v1/agents/connect/register", {
      method: "POST",
      headers,
      body: "{}",
    });

    expect(response.status).toBe(status);
    const body = (await response.json()) as { error: string; frame?: unknown };
    expect(body.error).toBe("agent_register_refused");
    expect(body.frame).toEqual(refusedFrame);
  });

  it("answers a registered frame and instance token with HTTP 200", async () => {
    const answer: AgentConnectRegisterAnswer = {
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
