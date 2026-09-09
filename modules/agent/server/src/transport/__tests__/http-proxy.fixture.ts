import type { WorkflowApi } from "@langwatch/workflow-contract";
import type { TraceApi } from "@langwatch/trace-contract";
import type { Actor } from "@langwatch/actor";
import type { AgentApi } from "@langwatch/agent-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { HttpAgentTestService } from "../../services/http-agent-test.service.ts";
import { httpProxyTrpcTransport } from "../http-proxy.trpc.ts";
import { agentTrpcCaller } from "./agent-trpc.fixture.ts";

export function createHttpProxyCaller(
  peers: { workflows: WorkflowApi; traces: TraceApi },
  actor: (Actor & { id: string }) | null = { type: "user", id: "user_1" },
) {
  const testing = HttpAgentTestService.create(peers);
  const app = createApiFixture<AgentApi>({ executeHttpTest: (input) => testing.execute(input) });

  return agentTrpcCaller({ declaration: httpProxyTrpcTransport, app, actor });
}
