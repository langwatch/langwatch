/**
 * The `/api/v1/agents` REST family and its deprecated `/api/agents` alias, driven through
 * the real Hono apps `createAgentV1RestApp` and `createAgentLegacyRestApp` build — mounted
 * @see specs/agents/agents-rest-api.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import type { Agent, AgentConfig, AgentType } from "@langwatch/agent-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it } from "vitest";

import { AgentApp } from "../../../app/agent.app";
import type { AgentsAuditLogPort, AgentsWorkflowPort } from "../../../ports/agent.port";
import type { AgentRepository, PersistAgentInput } from "../../../repositories/agent.repository";
import { AgentService } from "../../../services/agent.service";
import { createAgentLegacyRestApp } from "../agent-legacy.api";
import { createAgentV1RestApp } from "../agent-v1.api";

const PROJECT_ID = "project_agents";
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

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const asProject: MiddlewareHandler = async (c, next) => {
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
function inMemoryAgentRepository(): AgentRepository {
  const rows: Agent[] = [];
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
    findByIdentityKey: async () => null,
    findConnectedByNameAndEnvironment: async () => [],
    reregisterConnected: async () => {
      throw new Error("not used by these tests");
    },
    touchLastSeenAt: async () => {},
    findUserNamesByIds: async () => new Map(),
  };
}

const workflows: AgentsWorkflowPort = {
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

const auditLog: AgentsAuditLogPort = {
  history: async () => [],
};

function buildApps() {
  const repository = inMemoryAgentRepository();
  const agentService = AgentService.create({ repository, workflows, auditLog });
  const app = AgentApp.create({ agents: agentService });
  const agentPlatformUrl = ({ projectSlug, agentId }: { projectSlug: string; agentId: string }) =>
    `https://app.test/${projectSlug}/agents/${agentId}`;

  const v1 = createAgentV1RestApp({
    security: testSecurity(),
    agents: () => app,
    agentPlatformUrl,
  });
  const legacy = createAgentLegacyRestApp({
    security: testSecurity(),
    agents: () => app,
    agentPlatformUrl,
  });

  return {
    v1: (path: string, init?: RequestInit) => v1.hono.request(path, init),
    legacy: (path: string, init?: RequestInit) => legacy.hono.request(path, init),
    createAgent: async (overrides: { name?: string; type?: AgentType; config?: unknown } = {}) => {
      const response = await v1.hono.request("/api/v1/agents", {
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

describe("given a project with a valid API key", () => {
  let api: ReturnType<typeof buildApps>;

  beforeEach(() => {
    api = buildApps();
  });

  describe("when listing agents", () => {
    /** @scenario "List agents returns paginated non-archived agents" */
    it("answers a paginated list that leaves out the archived agent", async () => {
      const one = await api.createAgent({ name: "One" });
      await api.createAgent({ name: "Two" });
      await api.createAgent({ name: "Three" });
      const archived = await api.createAgent({ name: "Archived" });
      await api.v1(`/api/v1/agents/${archived.id}`, { method: "DELETE" });

      const response = await api.v1("/api/v1/agents");
      const body = (await response.json()) as {
        data: {
          id: string;
          name: string;
          type: string;
          config: unknown;
          createdAt: string;
          updatedAt: string;
        }[];
        pagination: { total: number };
      };

      expect(response.status).toBe(200);
      expect(body.data).toHaveLength(3);
      expect(body.data.map((a) => a.id)).not.toContain(archived.id);
      const row = body.data.find((a) => a.id === one.id)!;
      expect(row).toMatchObject({ id: one.id, name: "One", type: "signature" });
      expect(row).toHaveProperty("config");
      expect(row).toHaveProperty("createdAt");
      expect(row).toHaveProperty("updatedAt");
    });

    /** @scenario "List agents with page and limit parameters" */
    it("answers one page and the total count", async () => {
      for (let i = 0; i < 15; i++) {
        await api.createAgent({ name: `Agent ${i}` });
      }

      const response = await api.v1("/api/v1/agents?page=2&limit=5");
      const body = (await response.json()) as {
        data: unknown[];
        pagination: { page: number; limit: number; total: number };
      };

      expect(body.data).toHaveLength(5);
      expect(body.pagination).toMatchObject({ page: 2, limit: 5, total: 15 });
    });

    /** @scenario "List agents returns empty array for project with no agents" */
    it("answers an empty page for a project with no agents", async () => {
      const response = await api.v1("/api/v1/agents");
      const body = (await response.json()) as { data: unknown[] };

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
    });
  });

  describe("when creating an agent", () => {
    /** @scenario "Create an agent with name, type, and config" */
    it("creates it and answers 201 with the id, name, type and config", async () => {
      const response = await api.v1("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Agent", type: "signature", config: {} }),
      });
      const body = (await response.json()) as {
        id: string;
        name: string;
        type: string;
        config: unknown;
      };

      expect(response.status).toBe(201);
      expect(body).toMatchObject({ name: "My Agent", type: "signature" });
      expect(body.id).toBeTruthy();
      expect(body).toHaveProperty("config");
    });

    /** @scenario "Create an agent validates config against type schema" */
    it("refuses a config that does not match the type's schema", async () => {
      const response = await api.v1("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My Agent",
          type: "signature",
          config: { llm: { model: 42 } },
        }),
      });

      expect(response.status).toBe(422);
    });

    /** @scenario "Create an agent requires a name" */
    it("refuses a request with no name", async () => {
      const response = await api.v1("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "signature", config: {} }),
      });

      expect(response.status).toBe(422);
    });

    /** @scenario "Create an agent requires a type" */
    it("refuses a request with no type", async () => {
      const response = await api.v1("/api/v1/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Agent", config: {} }),
      });

      expect(response.status).toBe(422);
    });
  });

  describe("when reading one agent", () => {
    /** @scenario "Get an agent by id" */
    it("answers the agent's id, name, type and config", async () => {
      const created = await api.createAgent({ name: "Readable" });

      const response = await api.v1(`/api/v1/agents/${created.id}`);
      const body = (await response.json()) as {
        id: string;
        name: string;
        type: string;
        config: unknown;
      };

      expect(response.status).toBe(200);
      expect(body).toMatchObject({ id: created.id, name: "Readable", type: "signature" });
      expect(body).toHaveProperty("config");
    });

    /** @scenario "Get agent returns 404 for non-existent id" */
    it("answers 404 for an id the project does not hold", async () => {
      const response = await api.v1("/api/v1/agents/agent_doesnotexist");

      expect(response.status).toBe(404);
    });
  });

  describe("when updating an agent", () => {
    /** @scenario "Update an agent name" */
    it("updates the name and reflects it in the response", async () => {
      const created = await api.createAgent({ name: "Old Name" });

      const response = await api.v1(`/api/v1/agents/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Name" }),
      });
      const body = (await response.json()) as { name: string };

      expect(response.status).toBe(200);
      expect(body.name).toBe("Updated Name");
    });

    /** @scenario "Update an agent config" */
    it("updates the config", async () => {
      const created = await api.createAgent({ name: "Configurable" });

      const response = await api.v1(`/api/v1/agents/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { prompt: "new prompt" } }),
      });
      const body = (await response.json()) as { config: { prompt?: string } };

      expect(response.status).toBe(200);
      expect(body.config.prompt).toBe("new prompt");
    });

    /** @scenario "Update a non-existent agent returns 404" */
    it("answers 404 for an id that does not exist", async () => {
      const response = await api.v1("/api/v1/agents/agent_ghost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Whatever" }),
      });

      expect(response.status).toBe(404);
    });

    // The update is partial under either verb, so a caller reaching for the
    // one we did not route should not meet a 404 that reads as a missing agent.
    /** @scenario "Update an agent with PUT" */
    it("updates the agent the same way under PUT", async () => {
      const created = await api.createAgent({ name: "Put Me" });

      const response = await api.v1(`/api/v1/agents/${created.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed By Put" }),
      });
      const body = (await response.json()) as { name: string };

      expect(response.status).toBe(200);
      expect(body.name).toBe("Renamed By Put");
    });
  });

  describe("when archiving an agent", () => {
    /** @scenario "Delete an agent archives it" */
    it("soft-deletes it, and a later read answers 404", async () => {
      const created = await api.createAgent({ name: "To Archive" });

      const response = await api.v1(`/api/v1/agents/${created.id}`, { method: "DELETE" });
      const body = (await response.json()) as { archivedAt: string | null };

      expect(response.status).toBe(200);
      expect(body.archivedAt).not.toBeNull();

      const after = await api.v1(`/api/v1/agents/${created.id}`);
      expect(after.status).toBe(404);
    });

    /** @scenario "Delete a non-existent agent returns 404" */
    it("answers 404 for an id that does not exist", async () => {
      const response = await api.v1("/api/v1/agents/agent_nope", { method: "DELETE" });

      expect(response.status).toBe(404);
    });
  });
});

describe("given the deprecated /api/agents alias", () => {
  let api: ReturnType<typeof buildApps>;

  beforeEach(() => {
    api = buildApps();
  });

  describe("when an agent is listed, read, updated and archived through it", () => {
    /** @scenario "The alias answers the endpoints that predate the move" */
    it("answers each call the same way /api/v1/agents does", async () => {
      const created = await api.createAgent({ name: "Aliased" });

      const listed = await api.legacy("/api/agents");
      const listedBody = (await listed.json()) as { data: { id: string }[] };
      expect(listed.status).toBe(200);
      expect(listedBody.data.map((a) => a.id)).toContain(created.id);

      const read = await api.legacy(`/api/agents/${created.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toMatchObject({ id: created.id, name: "Aliased" });

      const updated = await api.legacy(`/api/agents/${created.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Aliased Renamed" }),
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ name: "Aliased Renamed" });

      const archived = await api.legacy(`/api/agents/${created.id}`, { method: "DELETE" });
      expect(archived.status).toBe(200);
      expect(await archived.json()).toMatchObject({ archivedAt: expect.any(String) });

      const afterArchive = await api.v1(`/api/v1/agents/${created.id}`);
      expect(afterArchive.status).toBe(404);
    });
  });

  describe("when the routes the move added are called through it", () => {
    /** @scenario "The endpoints added with the move answer only under /api/v1" */
    it("answers 404 Not Found for each of them", async () => {
      const created = await api.createAgent({ name: "Untestable Here" });

      const test = await api.legacy(`/api/agents/${created.id}/test`, { method: "POST" });
      const call = await api.legacy(`/api/agents/${created.id}/call`, { method: "POST" });
      const poll = await api.legacy("/api/agents/connect/poll");

      expect(test.status).toBe(404);
      expect(call.status).toBe(404);
      expect(poll.status).toBe(404);
    });
  });
});
