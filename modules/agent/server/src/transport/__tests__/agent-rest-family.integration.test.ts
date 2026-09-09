/**
 * The `/api/v1/agents` REST family and its deprecated `/api/agents` alias, driven through
 * the real Hono apps `createAgentV1RestApp` and `createAgentLegacyRestApp` build — mounted
 * @see specs/agents/agents-rest-api.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { agentSchema, type Agent } from "@langwatch/agent-contract";

import { AGENTS_ALIAS_SUCCESSOR } from "../agent-legacy.rest.ts";
import { createAgentV1RestApp } from "../agent.rest.ts";
import { buildAgentApps, PROJECT_ID, testSecurity } from "./agent-rest.fixture.ts";

it("declares every Agent REST protocol without resolving the app", () => {
  const agents = vi.fn(() => {
    throw new Error("OpenAPI must not resolve AgentApp");
  });
  const api = createAgentV1RestApp({
    security: testSecurity(),
    agents,
    agentPlatformUrl: () => "https://app.test/agents",
    connect: {},
    call: {},
  });

  expect(agents).not.toHaveBeenCalled();
  expect(api.routes.map((route) => route.path)).toEqual(
    expect.arrayContaining([
      "/api/v1/agents/connect/register",
      "/api/v1/agents/connect/poll",
      "/api/v1/agents/connect/frames",
      "/api/v1/agents/:id/call",
    ]),
  );
});

describe("given a project with a valid API key", () => {
  let api: Awaited<ReturnType<typeof buildAgentApps>>;

  beforeEach(async () => {
    api = await buildAgentApps();
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
      expect(Object.keys(row ?? {}).sort()).toEqual([
        "config",
        "createdAt",
        "environment",
        "hostLabel",
        "id",
        "instances",
        "lastSeenAt",
        "name",
        "notSelectableReason",
        "owner",
        "ownerUserId",
        "parameters",
        "platformUrl",
        "selectable",
        "status",
        "type",
        "updatedAt",
      ]);
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
  let api: Awaited<ReturnType<typeof buildAgentApps>>;

  beforeEach(async () => {
    api = await buildAgentApps();
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

  describe("when any of its endpoints answers", () => {
    /** @scenario "Every alias response carries the deprecation headers" */
    it("names the successor on the response", async () => {
      const response = await api.legacy("/api/agents");

      expect(response.status).toBe(200);
      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("Link")).toBe(
        `<${AGENTS_ALIAS_SUCCESSOR}>; rel="successor-version"`,
      );
      expect(response.headers.get("X-API-Deprecation-Notice")).toBe(
        `superseded by ${AGENTS_ALIAS_SUCCESSOR}`,
      );
    });

    /** @scenario "A refused alias request still carries the deprecation headers" */
    it("keeps naming it on a refusal", async () => {
      const response = await api.legacy("/api/agents/agent_nope");

      expect(response.status).toBe(404);
      expect(response.headers.get("Deprecation")).toBe("true");
      expect(response.headers.get("Link")).toBe(
        `<${AGENTS_ALIAS_SUCCESSOR}>; rel="successor-version"`,
      );
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

describe("given one name and one environment holding a personal row and a host-scoped row", () => {
  /** One connected agent row as the repository stores it. */
  function connectedRow(overrides: Partial<Agent> & { id: string }): Agent {
    return agentSchema.parse({
      projectId: PROJECT_ID,
      name: "support-agent",
      type: "connected",
      config: { parameters: [], sdk: { name: "test", version: "1", language: "typescript" } },
      environment: "development",
      workflowId: null,
      copiedFromAgentId: null,
      archivedAt: null,
      createdAt: new Date(1),
      updatedAt: new Date(1),
      ...overrides,
    });
  }

  /** @scenario "A listed connected agent carries its owner and whether the caller can choose it" */
  it("lists both rows and marks the personal one as not selectable", async () => {
    const api = await buildAgentApps({
      viewerUserId: "user_reader",
      seed: [
        connectedRow({ id: "agent_personal", ownerUserId: "user_ana" }),
        connectedRow({ id: "agent_hosted", hostLabel: "acme-laptop" }),
      ],
    });

    const response = await api.v1("/api/v1/agents?limit=100");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: {
        id: string;
        owner: { userId: string; name: string | null } | null;
        selectable: boolean;
        notSelectableReason: string | null;
      }[];
    };
    const personal = body.data.find((row) => row.id === "agent_personal");
    const hosted = body.data.find((row) => row.id === "agent_hosted");

    expect(personal?.owner?.userId).toBe("user_ana");
    expect(personal?.selectable).toBe(false);
    expect(personal?.notSelectableReason).toBe("owned_by_another_person");
    expect(hosted?.owner).toBeNull();
    expect(hosted?.selectable).toBe(true);
    expect(hosted?.notSelectableReason).toBeNull();
  });
});
