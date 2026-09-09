/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import {
  AgentBusyError,
  AgentNotFoundError,
  AgentOwnerOnlyError,
  type AgentApi,
} from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerCallEndpoint } from "../agent-call.rest.ts";
import { agentRestErrorHandler } from "../agent.rest.ts";

class ForbiddenTestError extends HandledError {
  constructor() {
    super("forbidden", "forbidden", { httpStatus: 403 });
  }
}

const boundaryErrorHandler: ErrorHandler = (error, c) => {
  const handled = error as Error & { code?: string; httpStatus?: number };
  if (typeof handled.code === "string" && typeof handled.httpStatus === "number") {
    return c.json({ error: handled.code, message: handled.message }, handled.httpStatus as 400);
  }
  return c.json({ error: "internal_server_error", message: "Internal server error" }, 500);
};

function testSecurity({
  projectId = "project-1",
  apiKeyUserId,
  authorizeRefuses = false,
}: {
  projectId?: string;
  apiKeyUserId?: string | null;
  authorizeRefuses?: boolean;
} = {}): { security: AppRestSecurity; chain: string[] } {
  const chain: string[] = [];
  const record =
    (label: string): MiddlewareHandler =>
    async (_c, next) => {
      chain.push(label);
      await next();
    };
  const authenticateProject: MiddlewareHandler = async (c, next) => {
    chain.push("authenticateProject");
    c.set("project", {
      id: projectId,
      name: "Project One",
      slug: "project-one",
      teamId: "team-1",
      organizationId: "organization-1",
      isPersonal: false,
      ownerUserId: null,
    });
    c.set("resolvedToken", {
      type: "apiKey",
      apiKeyId: "test-key",
      userId: apiKeyUserId ?? null,
      organizationId: "organization-1",
      project: {
        id: projectId,
        name: "Project One",
        slug: "project-one",
        teamId: "team-1",
        organizationId: "organization-1",
        isPersonal: false,
        ownerUserId: null,
      },
    });
    if (apiKeyUserId !== undefined) c.set("apiKeyUserId", apiKeyUserId ?? undefined);
    await next();
  };
  const authorizeProjectPermission: RestApiServicePorts["authorizeProjectPermission"] = ({
    permission,
  }) => {
    if (authorizeRefuses) {
      return async () => {
        chain.push(`authorize:${permission}:refused`);
        throw new ForbiddenTestError();
      };
    }
    return record(`authorize:${permission}`);
  };

  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: boundaryErrorHandler,
    canonicalErrorHandler: boundaryErrorHandler,
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission,
    authorizeApiKeyCeiling: ({ permission }) => record(`ceiling:${permission}`),
    authenticateOrganization: () => record("authenticateOrganization"),
    authorizeOrganizationPermission: ({ permission }) => record(`authorizeOrg:${permission}`),
    authorizeRouteTeamPermission: () => async (_c, next) => next(),
    authorizeRouteProjectPermission: ({ permission }) =>
      record(`authorizeRouteProject:${permission}`),
    authenticateOrganizationThrowing: record("authenticateOrganizationThrowing"),
    authorizeOrganizationPermissionThrowing: (permission) =>
      record(`authorizeOrgThrowing:${permission}`),
  };

  return { security: createAppRestSecurity(ports), chain };
}

const outcome = { output: "hi", instance: { hostname: "laptop", label: null }, durationMs: 12 };
const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
const headers = { "content-type": "application/json" };

function buildApi(
  options: {
    apiKeyUserId?: string | null;
    authorizeRefuses?: boolean;
    call?: AgentApi["call"];
    relayMaxPayloadMb?: number;
  } = {},
) {
  const { security, chain } = testSecurity(options);
  const family = security.createProjectVersionedApp({
    name: "agents-v1",
    basePath: "/api/v1/agents",
    errorEnvelope: "legacy",
    staticGeneration: "v1",
    errorHandler: agentRestErrorHandler,
  });
  const call = vi.fn(options.call ?? (async () => outcome));
  const app = createApiFixture<AgentApi>({ call });

  registerCallEndpoint({
    family,
    deps: { agents: () => app, relayMaxPayloadMb: options.relayMaxPayloadMb },
  });
  return { hono: family.service.build(), chain, call };
}

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
      projectId: "project-1",
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
