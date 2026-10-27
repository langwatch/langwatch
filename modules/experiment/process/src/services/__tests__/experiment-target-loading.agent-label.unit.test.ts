import { agentSchema, type Agent, type AgentApi } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import type { PromptApi } from "@langwatch/prompt-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { agentLoadKey } from "../../rules/experiment-execution-data.rules.ts";
import type {
  ExecutionDataServices,
  ExperimentWorkflowDsl,
} from "../experiment-execution-data.service.ts";
import { ExperimentTargetLoadingService } from "../experiment-target-loading.service.ts";

const PROJECT_ID = "project-1";

function agentAt(prompt: string): Agent {
  return agentSchema.parse({
    id: "agent-1",
    projectId: PROJECT_ID,
    name: "Support bot",
    workflowId: null,
    copiedFromAgentId: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    type: "signature",
    config: { prompt },
  });
}

function services(): ExecutionDataServices {
  return {
    datasets: createApiFixture<DatasetApi>(),
    prompts: createApiFixture<PromptApi>(),
    agents: createApiFixture<AgentApi>({
      getById: async ({ label }) => agentAt(label === "production" ? "v2" : "v3"),
    }),
    workflows: createApiFixture<ExperimentWorkflowDsl>(),
    entitlements: createApiFixture<ExecutionDataServices["entitlements"]>(),
    projects: createApiFixture<ExecutionDataServices["projects"]>(),
  };
}

describe("loading an agent target pinned to a label", () => {
  /** @scenario "An experiment agent target pinned to a label runs that version" */
  it("loads the agent at its label, and the latest when the target names none", async () => {
    const pinned = { type: "agent", dbAgentId: "agent-1", agentLabel: "production" };
    const latest = { type: "agent", dbAgentId: "agent-1" };

    const loaded = await ExperimentTargetLoadingService.create().loadAgents({
      projectId: PROJECT_ID,
      targets: [pinned, latest],
      services: services(),
    });

    expect(loaded.get(agentLoadKey(pinned))?.config).toMatchObject({ prompt: "v2" });
    expect(loaded.get(agentLoadKey(latest))?.config).toMatchObject({ prompt: "v3" });
  });
});
