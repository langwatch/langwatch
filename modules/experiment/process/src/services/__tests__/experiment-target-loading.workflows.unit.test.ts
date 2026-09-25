import { agentSchema, type Agent, type AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { describe, expect, it } from "vitest";

import type {
  ExecutionDataServices,
  ExperimentWorkflowDsl,
} from "../experiment-execution-data.service.ts";
import { ExperimentTargetLoadingService } from "../experiment-target-loading.service.ts";

const PROJECT_ID = "project-1";
const DSL = {
  workflow_id: "x",
  spec_version: "1.4",
  name: "x",
  icon: "x",
  description: "x",
  version: "1",
  nodes: [],
  edges: [],
  state: {},
};

type Catalogue = Record<string, { publishedId: string | null; versions: string[] }>;

function servicesOver(catalogue: Catalogue) {
  const calls: string[] = [];
  const workflows = createApiFixture<ExperimentWorkflowDsl>({
    findWorkflow: async ({ workflowId }) => {
      calls.push(`workflow:${workflowId}`);
      const entry = catalogue[workflowId];
      return entry
        ? { id: workflowId, name: `name-${workflowId}`, publishedId: entry.publishedId }
        : null;
    },
    findVersionDsl: async ({ workflowId, versionId }) => {
      calls.push(`dsl:${workflowId}@${versionId}`);
      return catalogue[workflowId]?.versions.includes(versionId) ? DSL : null;
    },
  });
  return {
    calls,
    services: {
      datasets: createApiFixture<DatasetApi>(),
      prompts: createApiFixture<PromptApi>(),
      agents: createApiFixture<AgentApi>(),
      workflows,
      entitlements: createApiFixture<ExecutionDataServices["entitlements"]>(),
      projects: createApiFixture<ExecutionDataServices["projects"]>(),
    },
  };
}

function workflowAgent(
  id: string,
  link: { workflowId?: string; configWorkflowId?: string },
): Agent {
  return agentSchema.parse({
    id,
    projectId: PROJECT_ID,
    name: id,
    workflowId: link.workflowId ?? null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    type: "workflow",
    config: link.configWorkflowId ? { workflow_id: link.configWorkflowId } : {},
  });
}

async function load({
  catalogue,
  targets,
  agents = [],
}: {
  catalogue: Catalogue;
  targets: Parameters<typeof ExperimentTargetLoadingService.loadWorkflows>[0]["targets"];
  agents?: Agent[];
}) {
  const { calls, services } = servicesOver(catalogue);
  const result = await ExperimentTargetLoadingService.loadWorkflows({
    projectId: PROJECT_ID,
    targets,
    services,
    loadedAgents: new Map(agents.map((agent) => [agent.id, agent])),
  });
  const loaded =
    result instanceof Map
      ? [...result.entries()].map(([key, workflow]) => [key, workflow.id, workflow.versionId])
      : result;
  return { calls, loaded };
}

const CATALOGUE: Catalogue = {
  "wf-a": { publishedId: "va1", versions: ["va1", "va2"] },
  "wf-b": { publishedId: "vb1", versions: ["vb1"] },
  "wf-draft": { publishedId: null, versions: ["vd1"] },
};

describe("ExperimentTargetLoadingService.loadWorkflows", () => {
  it("loads direct workflow targets once per workflow and version, ignoring other targets", async () => {
    expect(
      await load({
        catalogue: CATALOGUE,
        targets: [
          { type: "prompt", promptId: "p1" },
          { type: "workflow", workflowId: "wf-a" },
          { type: "workflow", workflowId: "wf-a" },
          { type: "workflow", workflowId: "wf-a", workflowVersionId: "va2" },
          { type: "workflow" },
        ],
      }),
    ).toEqual({
      calls: ["workflow:wf-a", "dsl:wf-a@va1", "workflow:wf-a", "dsl:wf-a@va2"],
      loaded: [
        ["wf-a::published", "wf-a", "va1"],
        ["wf-a::va2", "wf-a", "va2"],
      ],
    });
  });

  it("loads the workflow a workflow agent links to, after every direct target", async () => {
    expect(
      await load({
        catalogue: CATALOGUE,
        targets: [
          { type: "agent", dbAgentId: "agent-link" },
          { type: "agent", dbAgentId: "agent-config" },
          { type: "agent", dbAgentId: "agent-dup" },
          { type: "agent", dbAgentId: "agent-unloaded" },
          { type: "agent", dbAgentId: "agent-unlinked" },
          { type: "agent" },
          { type: "workflow", workflowId: "wf-a" },
        ],
        agents: [
          workflowAgent("agent-link", { workflowId: "wf-b" }),
          workflowAgent("agent-config", { configWorkflowId: "wf-b" }),
          workflowAgent("agent-dup", { workflowId: "wf-a", configWorkflowId: "wf-b" }),
          workflowAgent("agent-unlinked", {}),
        ],
      }),
    ).toEqual({
      calls: ["workflow:wf-a", "dsl:wf-a@va1", "workflow:wf-b", "dsl:wf-b@vb1"],
      loaded: [
        ["wf-a::published", "wf-a", "va1"],
        ["wf-b::published", "wf-b", "vb1"],
      ],
    });
  });

  it.each([
    [
      "an unknown workflow",
      "wf-missing",
      { error: 'Workflow "wf-missing" not found', status: 404 },
    ],
    [
      "a workflow with no committed version",
      "wf-draft",
      { error: 'Workflow "wf-draft" has no committed version to evaluate', status: 400 },
    ],
  ])("stops at %s, before any later load", async (_label, workflowId, failure) => {
    const direct = await load({
      catalogue: CATALOGUE,
      targets: [
        { type: "workflow", workflowId },
        { type: "workflow", workflowId: "wf-a" },
      ],
    });
    const linked = await load({
      catalogue: CATALOGUE,
      targets: [
        { type: "agent", dbAgentId: "agent" },
        { type: "agent", dbAgentId: "later" },
      ],
      agents: [
        workflowAgent("agent", { workflowId }),
        workflowAgent("later", { workflowId: "wf-b" }),
      ],
    });

    expect(direct.loaded).toEqual(failure);
    expect(direct.calls).toEqual([`workflow:${workflowId}`]);
    expect(linked.loaded).toEqual(failure);
    expect(linked.calls).toEqual([`workflow:${workflowId}`]);
  });

  it("refuses a pinned version the workflow does not have", async () => {
    expect(
      await load({
        catalogue: CATALOGUE,
        targets: [{ type: "workflow", workflowId: "wf-b", workflowVersionId: "vb9" }],
      }),
    ).toEqual({
      calls: ["workflow:wf-b", "dsl:wf-b@vb9"],
      loaded: { error: 'Workflow version "vb9" not found', status: 404 },
    });
  });
});
