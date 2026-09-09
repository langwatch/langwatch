/**
 * Both Agents doors — the tRPC router and the legacy REST app — driven over one AgentApp.
 * @vitest-environment node
 * @see packages/features/agent/specs/package-boundary.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentTrpcTransport } from "../../transport/agent.trpc.ts";
import { agentTrpcCaller } from "../../transport/__tests__/agent-trpc.fixture.ts";
import { buildAgentApps } from "../../transport/__tests__/agent-rest.fixture.ts";

const PROJECT_ID = "project_agents";
const OTHER_PROJECT_ID = "project_elsewhere";

async function harness() {
  const apps = await buildAgentApps();
  const caller = agentTrpcCaller({ declaration: agentTrpcTransport, app: apps.app });

  return { ...apps, caller };
}

describe("given one agent service behind both supported interfaces", () => {
  let api: Awaited<ReturnType<typeof harness>>;

  beforeEach(async () => {
    api = await harness();
  });

  describe("when a product user creates an agent through internal RPC", () => {
    /** @scenario "Internal RPC invokes the injected agent service" */
    it("invokes the injected service once and answers a contract agent", async () => {
      const create = vi.spyOn(api.repository, "create");

      const agent = await api.caller.create({
        projectId: PROJECT_ID,
        name: "From RPC",
        type: "signature",
        config: { prompt: "Answer clearly" },
      });

      expect(create).toHaveBeenCalledOnce();
      expect(agent).toMatchObject({
        projectId: PROJECT_ID,
        name: "From RPC",
        type: "signature",
      });
    });
  });

  describe("when a client creates an agent through legacy REST", () => {
    /** @scenario "Legacy REST forwards to the same agent service" */
    it("reaches the same service command and preserves the documented status", async () => {
      const create = vi.spyOn(api.repository, "create");

      const response = await api.legacy("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "From REST", type: "signature", config: {} }),
      });

      expect(response.status).toBe(201);
      expect(create).toHaveBeenCalledOnce();
      expect(await response.json()).toMatchObject({ name: "From REST", type: "signature" });

      const listed = await api.caller.getAll({ projectId: PROJECT_ID });
      expect(listed.map((agent) => agent.name)).toContain("From REST");
    });
  });

  describe("when the same invalid agent config is submitted through either interface", () => {
    /** @scenario "RPC and REST reject the same invalid agent config" */
    it("refuses both, each transport rendering the one domain failure its own way", async () => {
      const invalid = { name: "Broken", type: "code" as const, config: { parameters: [] } };

      await expect(api.caller.create({ projectId: PROJECT_ID, ...invalid })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      const response = await api.legacy("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalid),
      });
      expect(response.status).toBe(422);
    });
  });

  describe("when the caller is authorized only for another project", () => {
    /** @scenario "Agent operations remain project scoped" */
    it("returns and changes nothing for an agent that belongs elsewhere", async () => {
      const created = await api.createAgent({ name: "Owned by A" });

      await expect(
        api.caller.getById({ id: created.id, projectId: OTHER_PROJECT_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        api.caller.delete({ id: created.id, projectId: OTHER_PROJECT_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const stillThere = await api.caller.getById({ id: created.id, projectId: PROJECT_ID });
      expect(stillThere).toMatchObject({ id: created.id, archivedAt: null });
    });
  });

  describe("when an agent has been archived", () => {
    /** @scenario "Archived agents are absent from ordinary reads" */
    it("leaves it out of every ordinary read on either interface", async () => {
      const kept = await api.createAgent({ name: "Kept" });
      const archived = await api.createAgent({ name: "Archived" });
      await api.caller.delete({ id: archived.id, projectId: PROJECT_ID });

      const listed = await api.caller.getAll({ projectId: PROJECT_ID });
      expect(listed.map((agent) => agent.id)).toEqual([kept.id]);

      await expect(
        api.caller.getById({ id: archived.id, projectId: PROJECT_ID }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const restList = await api.legacy("/api/agents");
      const body = (await restList.json()) as { data: { id: string }[] };
      expect(body.data.map((agent) => agent.id)).toEqual([kept.id]);

      const restRead = await api.legacy(`/api/agents/${archived.id}`);
      expect(restRead.status).toBe(404);
    });
  });
});
