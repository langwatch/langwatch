import type { Actor } from "@langwatch/actor";
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import type { SecretApi } from "@langwatch/secret-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { WorkflowApi } from "@langwatch/workflow-contract";

import { agentFixture } from "../../app/__tests__/agent.fixture.ts";
import type { AgentService } from "../../services/agent.service.ts";
import { HttpAgentTestService } from "../../services/http-agent-test.service.ts";
import { httpProxyTrpcTransport } from "../http-proxy.trpc.ts";
import { agentTrpcCaller } from "./agent-trpc.fixture.ts";

export function createHttpProxyCaller(
  peers: { workflows: WorkflowApi; traces: TraceApi },
  actor: (Actor & { id: string }) | null = { type: "user", id: "user_1" },
) {
  // A saved agent here is not an HTTP one, so no stored credential fills the call.
  const testing = HttpAgentTestService.create({
    ...peers,
    agents: createApiFixture<Pick<AgentService, "getById">>({ getById: async () => agentFixture() }),
    secrets: createApiFixture<SecretApi>({ getValues: async () => ({}), list: async () => [] }),
  });
  const app = createApiFixture<AgentApi>({ executeHttpTest: (input) => testing.execute(input) });

  return agentTrpcCaller({ declaration: httpProxyTrpcTransport, app, actor });
}
