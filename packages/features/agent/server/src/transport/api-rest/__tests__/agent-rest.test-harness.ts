/**
 * The composition both Agents REST doors and the internal RPC router are driven
 * through in tests: one in-memory repository behind one AgentService, one
 * AgentApp, and the two Hono apps mounted on it.
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { Agent, AgentConfig, AgentType } from "@langwatch/agent-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { AgentApp } from "../../../app/agent.app";
import type { AgentsAuditLogPort, AgentsWorkflowPort } from "../../../ports/agent.port";
import type { AgentRepository, PersistAgentInput } from "../../../repositories/agent.repository";
import { AgentService } from "../../../services/agent.service";
import { createAgentLegacyRestApp } from "../agent-legacy.api";
import { createAgentV1RestApp } from "../agent-v1.api";

export const PROJECT_ID = "project_agents";
const PROJECT_SLUG = "agents-project";

/** Renders both the flat legacy envelope and a `HandledError` at its own status. */
const renderHandled: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
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

/** An `AgentRepository` on a plain array, enough for the REST family's own routes. */
export function inMemoryAgentRepository(seed: readonly Agent[] = []): AgentRepository {
  const rows: Agent[] = [...seed];
  let clock = 0;

  return {
    tryFindById: async ({ id, projectId }) =>
      rows.find((row) => row.id === id && row.projectId === projectId && !row.archivedAt) ?? null,
    tryFindByIdOnly: async (id) => rows.find((row) => row.id === id) ?? null,
    tryFindByIdIncludingArchived: async ({ id, projectId }) =>
      rows.find((row) => row.id === id && row.projectId === projectId) ?? null,
    findAll: async ({ projectId }) =>
      rows.filter((row) => row.projectId === projectId && !row.archivedAt),
    findReferenceStates: async () => [],
    findNamesByIds: async () => [],
    exists: async ({ id, projectId }) =>
      rows.some((row) => row.id === id && row.projectId === projectId && !row.archivedAt),
    findPage: async ({ projectId, page, limit }) => {
      const all = rows.filter((row) => row.projectId === projectId && !row.archivedAt);
      const start = (page - 1) * limit;
      return { data: all.slice(start, start + limit), total: all.length };
    },
    create: async (input: PersistAgentInput) => {
      const now = new Date(++clock);
      const row = {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        type: input.type,
        config: input.config,
        workflowId: input.workflowId ?? null,
        copiedFromAgentId: input.copiedFromAgentId ?? null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      } as Agent;
      rows.push(row);
      return row;
    },
    update: async (input) => {
      const at = rows.findIndex((row) => row.id === input.id && row.projectId === input.projectId);
      if (at === -1) throw new Error("agent not found");
      const existing = rows[at]!;
      const updated = {
        ...existing,
        ...(input.name !== undefined ? { name: input.name } : {}),
        type: input.type,
        ...(input.config !== undefined ? { config: input.config as AgentConfig } : {}),
        updatedAt: new Date(++clock),
      } as Agent;
      rows[at] = updated;
      return updated;
    },
    archive: async ({ id, projectId }) => {
      const at = rows.findIndex((row) => row.id === id && row.projectId === projectId);
      if (at === -1) throw new Error("agent not found");
      const updated = { ...rows[at]!, archivedAt: new Date(++clock) } as Agent;
      rows[at] = updated;
      return updated;
    },
    findCopies: async () => [],
    updateNameAndConfig: async () => {},
    tryFindByIdentityKey: async () => null,
    findConnectedByName: async () => [],
    findConnectedByNameAndEnvironment: async () => [],
    reregisterConnected: async () => {
      throw new Error("not used by these tests");
    },
    touchLastSeenAt: async () => {},
    findUserNamesByIds: async (ids: readonly string[]) =>
      new Map(ids.map((id) => [id, `Person ${id}`])),
  };
}

export const workflows: AgentsWorkflowPort = {
  fields: async () => ({}),
  related: async () => null,
  copy: async () => {
    throw new Error("not used by these tests");
  },
  archive: async () => {
    throw new Error("not used by these tests");
  },
  remove: async () => {},
};

export const auditLog: AgentsAuditLogPort = {
  history: async () => [],
};

export function buildAgentApps(
  options: { seed?: readonly Agent[]; viewerUserId?: string | null } = {},
) {
  const repository = inMemoryAgentRepository(options.seed ?? []);
  const agentService = AgentService.create({ repository, workflows, auditLog });
  const app = AgentApp.create({ agents: agentService });
  const agentPlatformUrl = ({ projectSlug, agentId }: { projectSlug: string; agentId: string }) =>
    `https://app.test/${projectSlug}/agents/${agentId}`;

  const v1 = createAgentV1RestApp({
    security: testSecurity(options.viewerUserId ?? null),
    agents: () => app,
    agentPlatformUrl,
  });
  const legacy = createAgentLegacyRestApp({
    security: testSecurity(options.viewerUserId ?? null),
    agents: () => app,
    agentPlatformUrl,
  });

  return {
    app,
    agentService,
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
