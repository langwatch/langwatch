/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  bindRestMiddleware,
  createRestRuntime,
  defineRestMiddleware,
  projectRestFacts,
  type RestCaller,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import {
  AgentBusyError,
  AgentNotFoundError,
  AgentOwnerOnlyError,
  type AgentApi,
} from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { agentRestErrorHandler, createAgentRest } from "../agent.rest.ts";

// Matched by name against `agent.rest.ts`'s own (unexported) `traceparent`
// fact - a mount binds a declared fact by name, not by object identity.
const traceparent = defineRestMiddleware("traceparent", z.string().nullable());

class ForbiddenTestError extends HandledError {
  constructor() {
    super("forbidden", "forbidden", { httpStatus: 403 });
  }
}

const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message, ...error.meta },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  return c.json({ error: "internal_server_error", message: "Internal server error" }, 500);
};

const PROJECT_ID = "project-1";

function buildApi(
  options: {
    apiKeyUserId?: string | null;
    authorizeRefuses?: boolean;
    call?: AgentApi["call"];
    relayMaxPayloadMb?: number;
  } = {},
) {
  const call = vi.fn(options.call ?? (async () => outcome));
  const app = createApiFixture<AgentApi>({ call });
  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ permission }): RestCaller => {
        if (options.authorizeRefuses && permission === "scenarios:create") {
          throw new ForbiddenTestError();
        }
        return {
          actor: { type: "user", id: options.apiKeyUserId ?? "u_2" },
          scope: { tier: "project", id: PROJECT_ID },
        };
      },
    },
  } as never);
  const hono = new Hono();
  hono.route(
    "/",
    runtime.mount(createAgentRest(options.relayMaxPayloadMb).router(), {
      app: () => app,
      onError: agentRestErrorHandler(renderRefusal),
      facts: [
        bindRestMiddleware(projectRestFacts, () => ({
          projectSlug: "project-one",
          viewerUserId: options.apiKeyUserId ?? null,
          actorId: options.apiKeyUserId ?? "u_2",
        })),
        bindRestMiddleware(traceparent, (context) => context.req.header("traceparent") ?? null),
      ],
    }),
  );
  return {
    hono: { request: (path: string, init?: RequestInit) => hono.request(`http://api.test${path}`, init) },
    call,
  };
}

const outcome = { output: "hi", instance: { hostname: "laptop", label: null }, durationMs: 12 };
const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
const headers = { "content-type": "application/json" };

describe("the connected-agent call boundary", () => {
  it("rejects oversized bodies before invoking the app", async () => {
    const { hono, call } = buildApi({ relayMaxPayloadMb: 0.0001 });
    const response = await hono.request("/api/v1/agents/agent_1/call", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: "agent_payload_too_large" });
    expect(call).not.toHaveBeenCalled();
  });

  it("preserves the busy refusal's retry-after header", async () => {
    const { hono } = buildApi({
      call: async () => {
        throw new AgentBusyError({ retryAfterMs: 1_500 });
      },
    });
    const response = await hono.request("/api/v1/agents/agent_1/call", {
      method: "POST",
      headers,
      body,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("2");
  });

  it("refuses a key without scenarios:create before invoking the app", async () => {
    const { hono, call } = buildApi({ authorizeRefuses: true });
    const response = await hono.request("/api/v1/agents/agent_1/call", {
      method: "POST",
      headers,
      body,
    });

    expect(response.status).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });

  it("keeps project isolation failures handled and forwards the authorized project", async () => {
    const { hono, call } = buildApi({
      call: async (input) => {
        throw new AgentNotFoundError(input.id, input.projectId);
      },
    });
    const response = await hono.request("/api/v1/agents/agent_elsewhere/call", {
      method: "POST",
      headers,
      body,
    });

    expect(response.status).toBe(404);
    expect(call.mock.calls[0]?.[0]).toEqual({
      id: "agent_elsewhere",
      projectId: PROJECT_ID,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("passes the actual key holder separately from untrusted input and preserves owner refusals", async () => {
    const { hono, call } = buildApi({
      apiKeyUserId: "u_2",
      call: async () => {
        throw new AgentOwnerOnlyError({
          agentId: "agent_1",
          agentName: "support-agent",
          ownerUserId: "u_1",
          ownerName: "u_1",
        });
      },
    });
    const response = await hono.request("/api/v1/agents/agent_1/call", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [], viewerUserId: "u_1" }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "agent_owner_only" });
    expect(call.mock.calls[0]?.[0]).not.toHaveProperty("viewerUserId");
    expect(call.mock.calls[0]?.[1]).toMatchObject({ viewerUserId: "u_2" });
  });

  it("preserves a machine caller and passes only the parsed trace header", async () => {
    const { hono, call } = buildApi();
    const response = await hono.request("/api/v1/agents/agent_1/call", {
      method: "POST",
      headers: { ...headers, traceparent: "00-trace-parent-01", authorization: "secret" },
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(outcome);
    expect(call.mock.calls[0]?.[1]).toMatchObject({
      viewerUserId: null,
      traceparent: "00-trace-parent-01",
    });
    expect(JSON.stringify(call.mock.calls)).not.toContain("secret");
  });

  it("rejects malformed input before the app call", async () => {
    const { hono, call } = buildApi();
    const response = await hono.request("/api/v1/agents/agent_1/call", {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: "wrong" }),
    });

    expect(response.status).toBe(422);
    expect(call).not.toHaveBeenCalled();
  });
});
