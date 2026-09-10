import { type AgentApi, type AgentWithFields } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication, NoApiTrpcFeatures } from "../api.application.ts";

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

/**
 * This suite's own double: a signature agent composes no `connected`
 * dependency, so `getAll` degrades to no owner, no parameters and offline
 * presence with no instances - the fixed view these tests pin.
 */
function fixtureAgentApp(overrides: Partial<AgentApi> = {}): AgentApi {
  return createApiFixture<AgentApi>({
    getAll: async () => [
      {
        ...agent,
        // The tRPC handler derives `_count.copiedAgents` from this field.
        copyCount: 0,
        environment: null,
        ownerUserId: null,
        hostLabel: null,
        lastSeenAt: null,
        parameters: [],
        owner: null,
        status: "offline",
        instances: [],
        selectable: true,
        notSelectableReason: null,
      },
    ],
    ...overrides,
  });
}

class AllowingFeatures extends NoApiTrpcFeatures {
  readonly authorization = {
    getDecision: vi.fn(async () => ({ permitted: true, organizationRole: null })),
    getProjectAnyDecision: vi.fn(async () => ({ permitted: true, organizationRole: null })),
    checkScopeLineage: vi.fn(async () => ({ kind: "consistent" as const })),
  };

  readonly errorReporting = {
    capture: async () => undefined,
    asError: (error: unknown) => error,
  };
}

describe("ApiApplication Agent tRPC composition", () => {
  it("mounts every legacy agents.* procedure with its legacy presenter shape", async () => {
    const agents = fixtureAgentApp();
    const features = new AllowingFeatures();
    const application = ApiApplication.create({
      agents,
      features,
    });
    const caller = application.createCaller({
      actor: () => ({ id: "user-1" }),
      tryActor: () => ({ id: "user-1" }),
      can: async () => true,
    });

    const agentCaller = caller.agents;
    if (!agentCaller) throw new Error("Agent router was not composed.");

    // The ADR-128 view every read carries now: this process composed no
    // `connected` dependency, so a non-connected agent degrades to no
    // declared parameters, no owner and offline presence with no instances —
    // and, holding no owner, it is one anybody may choose.
    await expect(agentCaller.getAll({ projectId: "project-1" })).resolves.toMatchObject([
      expect.objectContaining({
        id: agent.id,
        projectId: agent.projectId,
        name: agent.name,
        type: agent.type,
        config: agent.config,
        fieldsResolved: true,
        _count: { copiedAgents: 0 },
        ownerUserId: null,
        parameters: [],
        owner: null,
        status: "offline",
        instances: [],
        selectable: true,
        notSelectableReason: null,
      }),
    ]);
    expect(features.authorization.getDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        permission: "evaluations:view",
        scope: { tier: "project", id: "project-1" },
      }),
    );

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
      "testTurn",
      "testRun",
    ]);
  });

  it("refuses a copy command whose project inputs cross tenant boundaries", async () => {
    const agents = fixtureAgentApp();
    const features = new AllowingFeatures();
    features.authorization.checkScopeLineage.mockImplementation(async () => {
      throw new Error("scope lineage mismatch");
    });
    const application = ApiApplication.create({
      agents,
      features,
    });
    const caller = application.createCaller({
      actor: () => ({ id: "user-1" }),
      tryActor: () => ({ id: "user-1" }),
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

    expect(features.authorization.checkScopeLineage).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "project-1", sourceProjectId: "project-2" }),
    );
  });
});
