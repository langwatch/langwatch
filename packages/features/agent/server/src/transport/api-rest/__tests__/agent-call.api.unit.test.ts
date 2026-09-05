/**
 * @vitest-environment node
 * @see specs/agents/connected-agents.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { AgentOwnerOnlyError } from "@langwatch/agent-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { AgentApp } from "#app/agent.app";
import type { ConnectedAgentRuntime } from "../../../ports/connected-agent-runtime.port";
import { registerCallEndpoint, type AgentCallDeps } from "../agent-call.api";

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

const outcome = {
  output: "hi",
  session: undefined,
  instance: { hostname: "laptop", label: null },
  durationMs: 12,
};

function buildApi(
  {
    projectId = "project-1",
    apiKeyUserId,
    authorizeRefuses = false,
    agent,
    assertRunnable = vi.fn(async () => undefined),
    dispatch = vi.fn(async () => outcome),
  }: {
    projectId?: string;
    apiKeyUserId?: string | null;
    authorizeRefuses?: boolean;
    agent: unknown;
    assertRunnable?: AgentCallDeps["assertRunnable"];
    dispatch?: ReturnType<typeof vi.fn>;
  } = {} as never,
) {
  const { security, chain } = testSecurity({ projectId, apiKeyUserId, authorizeRefuses });
  const secured = security.createProjectApp({ basePath: "/api/v1/agents" });
  const getById = vi.fn(async () => agent);
  const app = { getById } as unknown as AgentApp;
  const runtime = {
    dispatcher: { dispatch },
  } as unknown as ConnectedAgentRuntime;
  const deps: AgentCallDeps = {
    agents: () => app,
    runtime: () => runtime,
    assertRunnable,
  };
  registerCallEndpoint({ secured, deps });
  return { hono: secured.hono, chain, getById, dispatch, assertRunnable };
}

const body = JSON.stringify({ messages: [{ role: "user", content: "hi" }] });
const headers = { "content-type": "application/json" };

describe("registerCallEndpoint", () => {
  describe("given a personal key that holds only scenarios:view", () => {
    /** @scenario "The relay route needs scenarios create" */
    it("refuses the call as forbidden", async () => {
      const { hono, dispatch } = buildApi({
        authorizeRefuses: true,
        agent: { id: "agent_1", type: "connected", name: "support-agent" },
      });

      const response = await hono.request("/api/v1/agents/agent_1/call", {
        method: "POST",
        headers,
        body,
      });

      expect(response.status).toBe(403);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("given a connected agent of another project", () => {
    /** @scenario "The relay route refuses an agent of another project" */
    it("refuses the call as not found", async () => {
      const { hono, dispatch } = buildApi({ agent: null });

      const response = await hono.request("/api/v1/agents/agent_elsewhere/call", {
        method: "POST",
        headers,
        body,
      });

      expect(response.status).toBe(404);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("given a personal development agent owned by user u_1", () => {
    /** @scenario "The relay route refuses a personal agent of another person" */
    it("refuses the call with agent_owner_only and dispatches nothing", async () => {
      const { hono, dispatch } = buildApi({
        apiKeyUserId: "u_2",
        agent: {
          id: "agent_1",
          type: "connected",
          name: "support-agent",
          environment: "development",
          ownerUserId: "u_1",
          config: {},
        },
        assertRunnable: vi.fn(async () => {
          throw new AgentOwnerOnlyError({
            agentId: "agent_1",
            agentName: "support-agent",
            ownerUserId: "u_1",
            ownerName: "u_1",
          });
        }),
      });

      const response = await hono.request("/api/v1/agents/agent_1/call", {
        method: "POST",
        headers,
        body,
      });
      const parsed = (await response.json()) as { error?: string };

      expect(parsed.error).toBe("agent_owner_only");
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("given a personal development agent owned by user u_1, where the owner gate already ran when the run was scheduled", () => {
    /** @scenario "The relay route lets the project key call a personal agent" */
    it("reaches the dispatcher, the way the scenario child does", async () => {
      const { hono, dispatch, assertRunnable } = buildApi({
        apiKeyUserId: undefined,
        agent: {
          id: "agent_1",
          type: "connected",
          name: "support-agent",
          environment: "development",
          ownerUserId: "u_1",
          config: {},
        },
      });

      const response = await hono.request("/api/v1/agents/agent_1/call", {
        method: "POST",
        headers,
        body,
      });

      expect(response.status).toBe(200);
      expect(assertRunnable).toHaveBeenCalled();
      expect(dispatch).toHaveBeenCalledTimes(1);
    });
  });
});
