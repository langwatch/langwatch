import { AgentService, type AgentWithFields } from "@langwatch/agent-contract";
import { getCurrentContext } from "@langwatch/observability/context";
import { SecretService } from "@langwatch/secret-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../api.application";

const agent: AgentWithFields = {
  id: "agent-1",
  projectId: "project-1",
  name: "Assistant",
  type: "signature",
  config: {
    name: "Assistant",
    llm: { model: "openai/gpt-4o", temperature: 0.2, max_tokens: 100 },
    prompt: "Answer clearly",
    inputs: [],
    outputs: [],
  },
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
  copyCount: 2,
};

class TestAgentService extends AgentService {
  readonly observedContexts: Array<ReturnType<typeof getCurrentContext>> = [];
  readonly getAll = vi.fn(async () => {
    this.observedContexts.push(getCurrentContext());
    return [agent];
  });

  private unavailable(): never {
    throw new Error("This test does not dispatch this agent service method.");
  }

  getById() {
    return this.unavailable();
  }
  getReferenceStates() {
    return this.unavailable();
  }
  getNamesByIds() {
    return this.unavailable();
  }
  exists() {
    return this.unavailable();
  }
  list() {
    return this.unavailable();
  }
  create() {
    return this.unavailable();
  }
  update() {
    return this.unavailable();
  }
  archive() {
    return this.unavailable();
  }
  relatedEntities() {
    return this.unavailable();
  }
  cascadeArchive() {
    return this.unavailable();
  }
  getCopies() {
    return this.unavailable();
  }
  getSourceOfCopy() {
    return this.unavailable();
  }
  copy() {
    return this.unavailable();
  }
  pushToCopies() {
    return this.unavailable();
  }
  syncFromSource() {
    return this.unavailable();
  }
  getHistory() {
    return this.unavailable();
  }
}

class TestSecretService extends SecretService {
  private unavailable(): never {
    throw new Error("Not used by this test.");
  }

  list() {
    return Promise.resolve([]);
  }

  getValues() {
    return Promise.resolve({});
  }

  async get() {
    return this.unavailable();
  }

  async create() {
    return this.unavailable();
  }

  async update() {
    return this.unavailable();
  }

  delete() {
    return Promise.resolve();
  }
}

describe("ApiApplication Agent tRPC composition", () => {
  it("mounts every legacy agents.* procedure with its legacy presenter shape", async () => {
    const agents = new TestAgentService();
    const authorize = vi.fn(async () => undefined);
    const application = ApiApplication.create({ agents, secrets: new TestSecretService() });
    const caller = application.createCaller({
      actor: () => ({ id: "user-1" }),
      authorize,
      can: async () => true,
    });

    const agentCaller = caller.agents;
    if (!agentCaller) throw new Error("Agent router was not composed.");

    await expect(agentCaller.getAll({ projectId: "project-1" })).resolves.toEqual([
      { ...agent, _count: { copiedAgents: 2 } },
    ]);
    expect(agents.observedContexts).toEqual([{ userId: "user-1" }]);
    expect(authorize).toHaveBeenCalledWith("evaluations:view", { projectId: "project-1" });

    const names = Object.keys(application.trpc._def.procedures)
      .filter((path) => path.startsWith("agents."))
      .map((path) => path.slice("agents.".length));

    expect(names).toEqual([
      "getAll",
      "getById",
      "create",
      "update",
      "getRelatedEntities",
      "cascadeArchive",
      "delete",
      "getCopies",
      "copy",
      "pushToCopies",
      "syncFromSource",
      "getHistory",
    ]);
  });

  /** @scenario "A process with no database composes no agent service" */
  it("mounts no agents surface at all for a process that composed no agent service", () => {
    const application = ApiApplication.create({ secrets: new TestSecretService() });

    const names = Object.keys(application.trpc._def.procedures).filter((path) =>
      path.startsWith("agents."),
    );

    expect(names).toEqual([]);
  });

  it("refuses a copy command whose project inputs cross tenant boundaries", async () => {
    const agents = new TestAgentService();
    const copy = vi.spyOn(agents, "copy");
    const authorizeScopeLineage = vi.fn(async () => {
      throw new Error("scope lineage mismatch");
    });
    const application = ApiApplication.create({ agents, secrets: new TestSecretService() });
    const caller = application.createCaller({
      actor: () => ({ id: "user-1" }),
      authorize: async () => undefined,
      authorizeScopeLineage,
      can: async () => true,
    });
    const agentCaller = caller.agents;
    if (!agentCaller) throw new Error("Agent router was not composed.");

    await expect(
      agentCaller.copy({
        agentId: "agent-1",
        projectId: "project-1",
        sourceProjectId: "project-2",
      }),
    ).rejects.toThrow("scope lineage mismatch");

    expect(authorizeScopeLineage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", sourceProjectId: "project-2" }),
      "evaluations:manage",
    );
    expect(copy).not.toHaveBeenCalled();
  });
});
