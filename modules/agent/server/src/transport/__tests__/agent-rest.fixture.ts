/**
 * The `/api/v1/agents` family, its connect protocol and its deprecated
 * `/api/agents` alias, mounted the way `apps/api/src/features/agent/agent-rest.mount.ts`
 * mounts them: one `createRestRuntime`, one door per family, real handlers.
 */
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Agent, AgentApi, AgentType } from "@langwatch/agent-contract";
import type { UserApi } from "@langwatch/user-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  bindRestMiddleware,
  createRestRuntime,
  defineRestMiddleware,
  projectRestFacts,
  type RestCaller,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import { Hono } from "hono";
import { z } from "zod";
import { agentConnectHeaders, createAgentConnectRest } from "../agent-connect.rest.ts";
import { agentLegacyRest } from "../agent-legacy.rest.ts";
import { agentRestErrorHandler, createAgentRest } from "../agent.rest.ts";
import { createAgentAppFixture } from "../../app/__tests__/agent.fixture.ts";

// Matched by name against `agent.rest.ts`'s own (unexported) `traceparent`
// fact - a mount binds a declared fact by name, not by object identity.
const traceparent = defineRestMiddleware("traceparent", z.string().nullable());

export const PROJECT_ID = "project_agents";
const PROJECT_SLUG = "agents-project";

/** The flat legacy envelope this family has always published. */
const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json(
      { error: error.code, message: error.message, ...error.meta },
      (error.httpStatus ?? 500) as ContentfulStatusCode,
    );
  }
  return c.json({ error: "internal_server_error", message: "Internal server error" }, 500);
};

export async function buildAgentApps(
  options: {
    seed?: readonly Agent[];
    viewerUserId?: string | null;
    denyPermission?: string;
    relayMaxPayloadMb?: number;
  } = {},
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

  const agents = () => app as AgentApi;
  const onError = agentRestErrorHandler(renderRefusal);
  // Every request authenticates as the same project and person; a route's
  // declared permission is granted unless `denyPermission` names it.
  const runtime = createRestRuntime({
    identity: {
      authenticate: ({ permission }): RestCaller => {
        if (options.denyPermission === permission) {
          throw new HandledError("forbidden", "Missing permission", { httpStatus: 403 });
        }
        return {
          actor: { type: "user", id: options.viewerUserId ?? "user_test" },
          scope: { tier: "project", id: PROJECT_ID },
        };
      },
    },
  } as never);
  const projectFacts = bindRestMiddleware(projectRestFacts, () => ({
    projectSlug: PROJECT_SLUG,
    viewerUserId: options.viewerUserId ?? null,
    actorId: "user_test",
  }));
  const connectFacts = bindRestMiddleware(agentConnectHeaders, (context) => ({
    authorization: context.req.header("authorization"),
    projectId: context.req.header("x-project-id"),
    instanceToken: context.req.header("x-agent-instance-token"),
  }));

  const hono = new Hono();
  hono.route(
    "/",
    runtime.mount(createAgentRest(options.relayMaxPayloadMb).router(), {
      app: agents,
      onError,
      facts: [
        projectFacts,
        bindRestMiddleware(traceparent, (context) => context.req.header("traceparent") ?? null),
      ],
    }),
  );
  hono.route(
    "/",
    runtime.mount(createAgentConnectRest(options.relayMaxPayloadMb).router(), {
      app: agents,
      onError,
      facts: [connectFacts],
    }),
  );
  hono.route(
    "/",
    runtime.mount(agentLegacyRest.router(), { app: agents, onError, facts: [projectFacts] }),
  );

  const send = (path: string, init?: RequestInit) => hono.request(`http://api.test${path}`, init);

  return {
    app,
    repository: repositories.agents,
    v1: send,
    legacy: send,
    connect: send,
    createAgent: async (overrides: { name?: string; type?: AgentType; config?: unknown } = {}) => {
      const response = await send("/api/v1/agents", {
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
