import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { Agent, AgentType } from "@langwatch/agent-contract";
import type { UserApi } from "@langwatch/user-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { HandledError } from "@langwatch/handled-error";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { createAgentAppFixture } from "../../testing.ts";
import { createAgentLegacyRestApp } from "../agent-legacy.rest.ts";
import { createAgentV1RestApp } from "../agent.rest.ts";

export const PROJECT_ID = "project_agents";
const PROJECT_SLUG = "agents-project";

/** Renders both the flat legacy envelope and a `HandledError` at its own status. */
const renderHandled: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof HandledError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: error.httpStatus },
    );
  }
  return c.json({ error: String(error) }, 500);
};

export function testSecurity(viewerUserId: string | null = null): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("apiKeyUserId", viewerUserId);
    c.set("project", {
      id: PROJECT_ID,
      name: "Agents Project",
      slug: PROJECT_SLUG,
      teamId: "team_1",
      organizationId: "org_1",
      isPersonal: false,
      ownerUserId: null,
    });
    c.set("apiKeyId", "key_test");
    c.set("resolvedToken", {
      type: "apiKey",
      apiKeyId: "key_test",
      userId: viewerUserId,
      organizationId: "org_1",
      project: c.get("project"),
    });
    await next();
  };
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
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

export async function buildAgentApps(
  options: { seed?: readonly Agent[]; viewerUserId?: string | null } = {},
) {
  const { app, repositories } = createAgentAppFixture({
    users: createApiFixture<UserApi>({ getProfiles: async () => [] }),
  });
  for (const agent of options.seed ?? []) {
    await repositories.agents.create({
      id: agent.id,
      projectId: agent.projectId,
      name: agent.name,
      type: agent.type,
      config: agent.config,
      workflowId: agent.workflowId ?? void 0,
      copiedFromAgentId: agent.copiedFromAgentId ?? void 0,
      ...(agent.type === "connected"
        ? {
            identity: {
              environment: agent.environment ?? "development",
              ownerUserId: agent.ownerUserId ?? null,
              hostLabel: agent.hostLabel ?? null,
              identityKey: agent.identityKey ?? agent.id,
            },
          }
        : {}),
    });
  }

  const agentPlatformUrl = ({ projectSlug, agentId }: { projectSlug: string; agentId: string }) =>
    `https://app.test/${projectSlug}/agents/${agentId}`;
  const optionsForRest = {
    security: testSecurity(options.viewerUserId ?? null),
    agents: () => app,
    agentPlatformUrl,
  };
  const v1 = createAgentV1RestApp(optionsForRest);
  const legacy = createAgentLegacyRestApp(optionsForRest);

  return {
    app,
    repository: repositories.agents,
    v1: (path: string, init?: RequestInit) => v1.request(path, init),
    legacy: (path: string, init?: RequestInit) => legacy.request(path, init),
    createAgent: async (overrides: { name?: string; type?: AgentType; config?: unknown } = {}) => {
      const response = await v1.request("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: overrides.name ?? "Agent",
          type: overrides.type ?? "signature",
          config: overrides.config ?? {},
        }),
      });
      return (await response.json()) as { id: string; name: string };
    },
  };
}
