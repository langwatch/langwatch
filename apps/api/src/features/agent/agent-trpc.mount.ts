import type { AgentApi } from "@langwatch/agent-contract";
import { agentTrpcTransport } from "@langwatch/agent-server";
import type { TrpcRuntime } from "@langwatch/api/trpc";

/** The one slice of the process context the agent namespaces read. */
export interface AgentTrpcContext {
  app: Readonly<{ agents: AgentApi }>;
}

export function createAgentTrpcRouter<TContext extends AgentTrpcContext>(
  runtime: TrpcRuntime<TContext>,
) {
  return runtime.mount(agentTrpcTransport, (ctx) => ctx.app.agents);
}
