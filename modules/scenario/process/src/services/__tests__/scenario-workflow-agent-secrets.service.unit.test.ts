import { AgentNotFoundError, agentOverviewSchema, type AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ScenarioWorkflowAgentSecretsService } from "../scenario-workflow-agent-secrets.service.ts";

const PROJECT_ID = "project-1";

const storedAgent = agentOverviewSchema.parse({
  id: "agent-1",
  projectId: PROJECT_ID,
  name: "Stored agent",
  type: "http",
  config: {
    url: "https://agent.example/chat",
    method: "POST",
    auth: { type: "api_key", header: "x-key", value: "stored-key" },
  },
  workflowId: null,
  copiedFromAgentId: null,
  archivedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  inputFields: [],
  outputFields: [],
  fieldsResolved: true,
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
});

const service = (known: boolean) =>
  ScenarioWorkflowAgentSecretsService.create(
    createApiFixture<AgentApi>({
      getById: async ({ id }) => {
        if (!known) throw new AgentNotFoundError(id, PROJECT_ID);

        return storedAgent;
      },
    }),
  );

const dsl = {
  name: "Workflow",
  nodes: [
    {
      id: "http_agent",
      data: {
        agent: "agents/agent-1",
        parameters: [
          { identifier: "agent_type", type: "str", value: "http" },
          { identifier: "auth_type", type: "str", value: "api_key" },
          { identifier: "auth_header", type: "str", value: "x-key" },
          { identifier: "auth_value", type: "str", value: "" },
          { identifier: "url", type: "str", value: "https://agent.example/chat" },
        ],
      },
    },
  ],
  edges: [],
};

const withAuthValue = (value: string) => ({
  nodes: [
    {
      data: { parameters: [{}, {}, {}, { identifier: "auth_value", value }] },
    },
  ],
});

describe("ScenarioWorkflowAgentSecretsService", () => {
  /** @scenario A workflow target's saved HTTP agents run with the credentials the agents store */
  it("fills a saved HTTP agent node's blank credential from the stored agent", async () => {
    const filled = await service(true).fill({ dsl, projectId: PROJECT_ID });

    expect(filled).toMatchObject(withAuthValue("stored-key"));
  });

  /** @scenario A workflow target's saved HTTP agents run with the credentials the agents store */
  it("leaves the node blank when the saved agent no longer exists", async () => {
    const filled = await service(false).fill({ dsl, projectId: PROJECT_ID });

    expect(filled).toMatchObject(withAuthValue(""));
  });
});
