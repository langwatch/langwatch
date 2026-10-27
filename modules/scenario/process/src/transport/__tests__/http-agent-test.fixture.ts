import { agentOverviewSchema, type AgentApi } from "@langwatch/agent-contract";
import type { Actor } from "@langwatch/authorization";
import type { SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { HttpAgentTestService } from "../../services/http-agent-test.service.ts";
import { scenarioTrpcTransport } from "../scenario.trpc.ts";
import { scenarioTrpcCaller, stubScenarioApi } from "./scenario-trpc.fixture.ts";

/** A saved agent that is not an HTTP one, so no stored credential fills the call. */
export const savedSignatureAgent = agentOverviewSchema.parse({
  id: "agent_1",
  projectId: "project_1",
  name: "Signature agent",
  type: "signature",
  config: { prompt: "Help the user" },
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

/** `scenarios.testHttpAgent` over the real service, its engine and trace peers stubbed. */
export function createHttpAgentTestCaller(
  peers: { workflows: WorkflowApi; traces: TraceApi },
  actor: (Actor & { id: string }) | null = { type: "user", id: "user_1" },
) {
  const testing = HttpAgentTestService.create({
    ...peers,
    agents: createApiFixture<AgentApi>({ getById: async () => savedSignatureAgent }),
    secrets: createApiFixture<SecretApi>({ getValuesByName: async () => ({}) }),
  });
  const { caller } = scenarioTrpcCaller({
    declaration: scenarioTrpcTransport,
    app: stubScenarioApi({ testHttpAgent: (input) => testing.execute(input) }),
    permissions: ["evaluations:manage"],
    actor,
  });

  return { execute: caller.testHttpAgent };
}
