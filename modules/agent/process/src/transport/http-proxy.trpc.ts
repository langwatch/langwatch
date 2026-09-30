import { AgentApi, httpProxyTrpc } from "@langwatch/agent-contract";
import { defineTrpcRouter, type TrpcRouterDeclaration } from "@langwatch/api/trpc";

export const httpProxyTrpcTransport: TrpcRouterDeclaration<AgentApi, typeof httpProxyTrpc> =
  defineTrpcRouter(AgentApi, httpProxyTrpc)
    .procedure("execute")
    .withPermission("evaluations:manage")
    .handle(({ input, app, actor }) => app.executeHttpTest({ ...input, actorId: actor.id }))
    .build();
